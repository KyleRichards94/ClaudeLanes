import { parseAdoGitRemote, type AdoGitRemote } from '@agent-lanes/ado-client';
import {
  PULL_REQUEST_DESCRIPTION_MAX,
  PULL_REQUEST_TITLE_MAX,
  err,
  formatPullRequestActivity,
  isPullRequestClosed,
  ok,
  pullRequestOutcome,
  pullRequestRef,
  type AgentTranscript,
  type CreateTicketPullRequestRequest,
  type CreateTicketPullRequestResponse,
  type PullRequestDraft,
  type PullRequestSnapshot,
  type Result,
  type TicketPullRequest,
  type TicketPullRequestState,
  type TicketRecord,
} from '@agent-lanes/contracts';
import type { AdoService } from '../ado';
import type { TranscriptService } from '../agent/output/transcript';
import type { ConnectionsService } from '../connections';
import type { GitRunner } from '../git/git-runner';
import type { Emit } from '../ipc/emit';
import type { Logger } from '../logging';
import type { TicketRecordStore } from '../tickets';

/**
 * The Create PR stage (AL-181, design §7 ADO write-back, §9 alternative to step 5, artboard 6 "PR open").
 *
 * Once the ticket is in Create PR (after its gate, AL-104), the drill-in asks for a draft: the title
 * from the ticket and the description from the agent's last summary in its output. The user edits
 * both and creates the PR: the ticket branch is pushed to origin, the PR is opened from it into the
 * base branch in the repository origin points at, and linked to the ticket's work item
 * (`workItemRefs`, checked and linked again by ado-client if ADO dropped it). The PR is kept on the
 * ticket record, so the card shows "PR !10612 · 3 / 4 checks" after a restart.
 *
 * Open PRs are read again every `pollMs` and on `pr:get`; each change is sent as `pr:status`. A PR that
 * is completed or abandoned moves the ticket to Done (design §9 step 6).
 */
export interface PullRequestService {
  draft(ticketId: string): Promise<Result<PullRequestDraft>>;
  create(request: CreateTicketPullRequestRequest): Promise<Result<CreateTicketPullRequestResponse>>;
  /** Reads the ticket's PR again; null when it has none. */
  refresh(ticketId: string): Promise<Result<TicketPullRequestState | null>>;
  /** Starts reading open PRs every `pollMs`. */
  watch(): void;
  dispose(): void;
}

export interface PullRequestServiceOptions {
  tickets: Pick<TicketRecordStore, 'get' | 'update' | 'list'>;
  ado: Pick<AdoService, 'createPullRequest' | 'getPullRequest'>;
  connections: Pick<ConnectionsService, 'list'>;
  git: GitRunner;
  emit: Emit;
  transcripts?: Pick<TranscriptService, 'get' | 'appendSystem'>;
  log?: Pick<Logger, 'info' | 'warn'>;
  now?: () => number;
  /** How often open PRs are read again. */
  pollMs?: number;
}

export const PULL_REQUEST_POLL_MS = 60_000;

/** The repository a draft names: "OnSite Companion / OnSite". */
function repositoryLabel(remote: AdoGitRemote): string {
  return `${remote.project} / ${remote.repository}`;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The lead agent's last finished prose: its summary of the work. */
export function agentSummary(transcript: AgentTranscript | undefined): string | null {
  const events = transcript?.events ?? [];
  for (let index = events.length - 1; index >= 0; index--) {
    const item = events[index]!.item;
    if (item.kind === 'text' && item.parentToolUseId === null && item.text.trim()) return item.text.trim();
  }
  return null;
}

/** Title and description the form starts with. */
export function draftPullRequestText(record: TicketRecord, summary: string | null): { title: string; description: string } {
  const title = clip(record.title.trim() || `Agent Lanes ticket ${record.id}`, PULL_REQUEST_TITLE_MAX);
  const footer = `Opened by Agent Lanes from ticket ${record.id} (branch \`${record.branch}\`).`;
  const body = summary ?? record.title.trim();
  const room = PULL_REQUEST_DESCRIPTION_MAX - footer.length - 2;
  const description = body ? `${clip(body, room)}\n\n${footer}` : footer;
  return { title, description };
}

function sameOrg(a: string, b: string): boolean {
  return a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();
}

export function createPullRequestService(options: PullRequestServiceOptions): PullRequestService {
  const { tickets, ado, connections, git, emit } = options;
  const now = options.now ?? Date.now;
  const pollMs = options.pollMs ?? PULL_REQUEST_POLL_MS;
  let timer: ReturnType<typeof setInterval> | undefined;
  /** The last status sent per ticket, so an unchanged poll sends nothing. */
  const lastSent = new Map<string, string>();

  async function remoteOf(record: TicketRecord): Promise<Result<AdoGitRemote>> {
    try {
      const { stdout } = await git(['remote', 'get-url', 'origin'], { cwd: record.repo });
      const parsed = parseAdoGitRemote(stdout.trim());
      if (!parsed.ok) return err('VALIDATION', "The repo's origin is not an Azure Repos remote, so a pull request can't be opened in Azure DevOps.");
      return parsed;
    } catch {
      return err('VALIDATION', 'The repo has no origin remote to push the ticket branch to.');
    }
  }

  /** The ADO connection for the remote's organisation, or for the work item's; null for the first connected one. */
  async function orgFor(record: TicketRecord, remote: AdoGitRemote): Promise<string | null> {
    const all = await connections.list();
    const match = all.find((connection) => connection.kind === 'ado' && (sameOrg(connection.orgUrl, remote.orgUrl) || (record.ado !== null && sameOrg(connection.orgUrl, record.ado.orgUrl))));
    return match?.id ?? null;
  }

  function blockedReason(record: TicketRecord): string | null {
    if (record.stage !== 'create-pr') return 'The ticket reaches Create PR once its earlier stages and gates are done.';
    if (record.ado === null) return 'This ticket has no Azure DevOps work item to link the pull request to.';
    return null;
  }

  function sendStatus(ticketId: string, saved: TicketPullRequest, snapshot: PullRequestSnapshot | null): void {
    const checks = snapshot ? { passed: snapshot.checks.passed, total: snapshot.checks.total, pending: snapshot.checks.pending } : null;
    const key = JSON.stringify([saved.id, saved.status, checks]);
    if (lastSent.get(ticketId) === key) return;
    lastSent.set(ticketId, key);
    emit('pr:status', { ticketId, pullRequestId: saved.id, status: saved.status, checks, webUrl: saved.webUrl });
  }

  /** A completed or abandoned PR moves the ticket to Done (design §9 step 6). */
  async function closeTicket(record: TicketRecord, snapshot: PullRequestSnapshot): Promise<void> {
    if (record.stage === 'done') return;
    const saved = await tickets.update(record.id, (current) => ({ ...current, stage: 'done' }));
    if (!saved.ok) {
      options.log?.warn(`Could not move ticket ${record.id} to Done after its PR closed: ${saved.message}`);
      return;
    }
    const outcome = pullRequestOutcome(snapshot.pullRequest);
    const activity = formatPullRequestActivity(snapshot.pullRequest);
    emit('agent:stage', { ticketId: record.id, change: 'stage', stage: 'done', from: record.stage, activity, progress: 0 });
    options.transcripts?.appendSystem(record.id, `PR !${snapshot.pullRequest.id} ${outcome} · moved to Done`);
    options.log?.info(`Ticket ${record.id} moved to Done: PR !${snapshot.pullRequest.id} ${outcome}`);
  }

  /** Saves what ADO said about the PR on the record, tells the renderer, and closes the ticket when the PR closed. */
  async function apply(record: TicketRecord, snapshot: PullRequestSnapshot): Promise<Result<TicketPullRequestState>> {
    const current = record.pullRequest;
    if (!current) return err('INTERNAL', `Ticket ${record.id} has no pull request.`);
    const closed = isPullRequestClosed(snapshot.pullRequest);
    const next: TicketPullRequest = {
      ...current,
      status: snapshot.pullRequest.status,
      webUrl: snapshot.pullRequest.webUrl,
      closedAt: closed ? (current.closedAt ?? now()) : null,
    };
    let latest = record;
    if (next.status !== current.status || next.closedAt !== current.closedAt || next.webUrl !== current.webUrl) {
      const saved = await tickets.update(record.id, (stored) => ({ ...stored, pullRequest: next }));
      if (!saved.ok) return saved;
      latest = saved.data;
    }
    sendStatus(record.id, next, snapshot);
    if (closed) await closeTicket(latest, snapshot);
    return ok({ pullRequest: next, snapshot });
  }

  async function refresh(ticketId: string): Promise<Result<TicketPullRequestState | null>> {
    const record = await tickets.get(ticketId);
    if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`);
    const saved = record.pullRequest;
    if (!saved) return ok(null);
    const snapshot = await ado.getPullRequest({ ...saved.ref, ...(saved.org ? { org: saved.org } : {}) });
    if (!snapshot.ok) return snapshot;
    return apply(record, snapshot.data);
  }

  function watch(): void {
    if (timer) return;
    timer = setInterval(() => {
      poll().catch((cause) => options.log?.warn(`Reading open PRs failed: ${cause instanceof Error ? cause.message : String(cause)}`));
    }, pollMs);
    timer.unref?.();
  }

  async function poll(): Promise<void> {
    const open = (await tickets.list()).filter((record) => record.pullRequest && record.pullRequest.status === 'active');
    for (const record of open) {
      const refreshed = await refresh(record.id);
      if (!refreshed.ok) options.log?.warn(`Could not read the PR of ticket ${record.id}: ${refreshed.message}`);
    }
  }

  return {
    async draft(ticketId) {
      const record = await tickets.get(ticketId);
      if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`);
      const transcript = await options.transcripts?.get(ticketId).catch(() => undefined);
      const text = draftPullRequestText(record, agentSummary(transcript));
      const remote = await remoteOf(record);
      return ok({
        ...text,
        sourceBranch: record.branch,
        targetBranch: record.baseBranch,
        workItemId: record.ado?.workItemId ?? null,
        repository: remote.ok ? repositoryLabel(remote.data) : null,
        blocked: blockedReason(record) ?? (remote.ok ? null : remote.message),
      });
    },

    async create({ ticketId, title, description, isDraft }) {
      const record = await tickets.get(ticketId);
      if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`);
      if (record.pullRequest && record.pullRequest.status === 'active') {
        const existing = await refresh(ticketId);
        if (!existing.ok) return existing;
        if (existing.data) return ok({ ...existing.data, created: false });
      }
      const blocked = blockedReason(record);
      if (blocked) return err('VALIDATION', blocked);
      const remote = await remoteOf(record);
      if (!remote.ok) return remote;

      // ADO opens a PR only from a branch it has: push the ticket branch first.
      try {
        await git(['push', '--quiet', '--porcelain', '--set-upstream', 'origin', `refs/heads/${record.branch}:refs/heads/${record.branch}`], { cwd: record.worktreePath, timeoutMs: 120_000 });
      } catch (cause) {
        options.log?.warn(`Ticket ${ticketId}: pushing ${record.branch} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
        return err('INTERNAL', `Pushing ${record.branch} to origin failed, so the pull request was not opened. Check the remote and try again.`, { reason: 'push-failed' });
      }

      const org = await orgFor(record, remote.data);
      const created = await ado.createPullRequest({
        ...(org ? { org } : {}),
        project: remote.data.project,
        repository: remote.data.repository,
        sourceBranch: record.branch,
        targetBranch: record.baseBranch,
        title,
        description,
        workItemIds: record.ado ? [record.ado.workItemId] : [],
        ...(isDraft ? { isDraft } : {}),
      });
      if (!created.ok) return created;
      const pr = created.data.pullRequest;
      const saved: TicketPullRequest = {
        ref: pullRequestRef(pr),
        org,
        id: pr.id,
        webUrl: pr.webUrl,
        status: pr.status,
        openedAt: now(),
        closedAt: null,
      };
      const stored = await tickets.update(ticketId, (current) => ({ ...current, pullRequest: saved }));
      if (!stored.ok) return stored;
      options.transcripts?.appendSystem(ticketId, `PR !${pr.id} ${created.data.created ? 'opened' : 'found'} · ${record.branch} → ${record.baseBranch}${record.ado ? ` · linked to #${record.ado.workItemId}` : ''}`);
      options.log?.info(`Ticket ${ticketId}: PR !${pr.id} ${created.data.created ? 'created' : 'reused'}`);
      watch();

      // The checks come with the next read; until then the card shows "PR !10612".
      const snapshot = await ado.getPullRequest({ ...saved.ref, ...(org ? { org } : {}) });
      if (!snapshot.ok) {
        sendStatus(ticketId, saved, null);
        return ok({ pullRequest: saved, snapshot: { pullRequest: pr, checks: { passed: 0, total: 0, pending: 0, failing: [], checks: [] } }, created: created.data.created });
      }
      const applied = await apply(stored.data, snapshot.data);
      return applied.ok ? ok({ ...applied.data, created: created.data.created }) : applied;
    },

    refresh,

    watch,

    dispose() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
  };
}
