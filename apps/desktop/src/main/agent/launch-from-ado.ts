import { randomBytes } from 'node:crypto';
import {
  getSignedInUser,
  getWorkItemAssignment,
  inProgressStateOf,
  setWorkItemAssignment,
  type AdoClient,
  type AdoPerson,
  type WorkItemAssignment,
} from '@agent-lanes/ado-client';
import {
  ADO_SCOPE_LABELS,
  DROP_REFUSALS,
  dropVerdict,
  err,
  ok,
  type ActivePullRequest,
  type AdoConnectionSummary,
  type AdoScope,
  type DropAction,
  type DropCard,
  type DropMe,
  type Err,
  type Lane,
  type LaunchAdoChange,
  type LaunchFromAdoRequest,
  type LaunchFromAdoResponse,
  type LaunchRefusal,
  type Result,
  type StageGates,
  type TeamBoardItem,
  type TicketRecord,
} from '@agent-lanes/contracts';
import type { AdoService } from '../ado';
import type { ConnectionsService } from '../connections';
import type { Logger } from '../logging';
import type { SettingsService } from '../settings/service';
import type { TicketRecordStore } from '../tickets';
import type { CreateTicketWorktreeInput, TicketWorktreeService } from '../worktrees';
import { createKeyedQueue } from '../worktrees/keyed-queue';
import type { SessionWorkItem } from './first-turn';
import type { LaunchQueue } from './launch-queue';
import { LANE_LABELS as LANE_NAMES } from './stages/stage-rules';

/**
 * Launch from the team board (AL-236, T3–T5, T9, TB§4 "Drop flow"): one main-process transaction.
 *
 * 1. Read the card again from Azure DevOps (the team board, the backlog item, or the open PR) and re-run
 *    the drop rules (AL-230) against it and the signed-in identity: a card that moved column, was taken,
 *    or already has an agent is refused ("Moved to Testing — refreshed").
 * 2. Only for a To Do, Failed or backlog item on Planning or Implementing: assign it to the identity the
 *    token signs in as and move it to In Progress, in one guarded revision. No other drop writes to ADO.
 * 3. Create the worktree: from main, on the item's branch, or on the PR's source branch (detached and
 *    read-only for a review).
 * 4. Create the ticket and start its session with the lane's skills, model, effort and gates (Planning
 *    keeps the plan gate, Implementing skips it); the card enters the dropped lane as the session starts,
 *    or waits in Queued at the concurrency cap (AL-111).
 *
 * A failing step rolls back the ones before it: the worktree and ticket go, and the item's assignee and
 * state are put back. The answer carries an undo id (AL-237).
 */
export interface AdoLauncher {
  launch(request: LaunchFromAdoRequest): Promise<Result<LaunchFromAdoResponse>>;
  /** The lane a launched ticket enters as its session starts; undefined for tickets not launched from the board. */
  startLane(ticketId: string): Lane | undefined;
  /** What a launch did, for Undo (AL-237); undefined once the id is unknown or used. */
  undoEntry(undoId: string): LaunchUndoEntry | undefined;
  /** Forgets an undo id (used, expired, or no longer allowed). */
  forgetUndo(undoId: string): void;
  /** The launch of `ticketId` Undo can still take back, if any (AL-237 watches its session). */
  undoEntryForTicket(ticketId: string): LaunchUndoEntry | undefined;
}

/** The id of a launch's success toast, so main can replace it when Undo can no longer run (AL-237). */
export function launchToastId(ticketId: string): string {
  return `launch-from-ado:${ticketId}`;
}

/** Everything Undo needs to take a launch back (AL-237). */
export interface LaunchUndoEntry {
  undoId: string;
  ticketId: string;
  lane: Lane;
  /** The organisation's connection, for the ADO restore. */
  org: string;
  /** Set when the launch assigned and moved a work item. */
  ado: AdoRestore | null;
  /** True for a review agent (it posts comments to the PR). */
  review: boolean;
  createdAt: number;
}

/** How to put a work item back as it was before the drop. */
export interface AdoRestore {
  project: string;
  workItemId: number;
  previousAssignee: AdoPerson | null;
  previousState: string;
  /** The revision the drop's own change produced; a restore is refused when someone changed it since. */
  rev: number;
}

export interface AdoLauncherOptions {
  ado: Pick<AdoService, 'clientFor' | 'teamBoard' | 'activePrs' | 'getWorkItem'>;
  connections: Pick<ConnectionsService, 'get' | 'list'>;
  worktrees: Pick<TicketWorktreeService, 'create' | 'discard'>;
  launches: Pick<LaunchQueue, 'launch'>;
  tickets: Pick<TicketRecordStore, 'get' | 'list'>;
  settings: Pick<SettingsService, 'get'>;
  /** The registered repo whose origin is the PR's repository (AL-232's remotes); null when none is. */
  repoForPullRequest: (orgUrl: string, pullRequest: ActivePullRequest) => Promise<string | null>;
  /** The lane's skills, model and effort for a drop (TB§3; Settings › Drops, AL-240). The action's own by default. */
  laneDefaults?: (action: DropAction) => Pick<DropAction, 'skills' | 'model' | 'effort'>;
  log?: Pick<Logger, 'info' | 'warn'>;
  now?: () => number;
}

/** A card as main read it again, with what the launch needs beyond the drop rules. */
interface FreshCard {
  card: DropCard;
  title: string;
  /** The project the work item lives in; the request's or the connection's default for a PR. */
  project: string;
  workItem: { id: number; columnName: string | null } | null;
  /** For a PR, or a Code Review item's linked PR. */
  pullRequest: ActivePullRequest | null;
}

function refusal(reason: LaunchRefusal, message: string, extra: Record<string, unknown> = {}): Err {
  return err('VALIDATION', message, { reason, ...extra });
}

/** `/code-review` → `code-review`. */
function skillName(skill: string): string {
  return skill.startsWith('/') ? skill.slice(1) : skill;
}

/** Which scope each kind of launch needs: an item drop writes Work Items; a PR agent pushes and comments (Code). */
function scopeFor(action: DropAction): AdoScope | null {
  if (action.changesAdo) return 'work-items';
  if (action.worktree === 'pr-source-branch' || action.worktree === 'pr-branch-read-only') return 'code';
  return null;
}

function isReview(action: DropAction): boolean {
  return action.worktree === 'pr-branch-read-only';
}

export function createAdoLauncher(options: AdoLauncherOptions): AdoLauncher {
  const { ado, connections, worktrees, launches, tickets, settings, log } = options;
  const now = options.now ?? Date.now;
  const startLanes = new Map<string, Lane>();
  const undo = new Map<string, LaunchUndoEntry>();
  /** Two drops of one card run one after the other, so the second sees what the first did. */
  const perCard = createKeyedQueue();

  async function connectionFor(org: string | undefined): Promise<AdoConnectionSummary | undefined> {
    const found = org === undefined ? (await connections.list()).find((row) => row.kind === 'ado') : await connections.get(org);
    return found?.kind === 'ado' ? found : undefined;
  }

  /** The lane an item's agent is already in, if one is (one agent per work item). */
  async function agentLaneOf(workItemId: number): Promise<Lane | null> {
    const records = await tickets.list();
    return records.find((record) => record.ado?.workItemId === workItemId && record.stage !== 'done')?.stage ?? null;
  }

  async function readCard(request: LaunchFromAdoRequest, org: string, project: string): Promise<Result<FreshCard>> {
    const { source } = request;
    if (source.kind === 'board-item') {
      const board = await ado.teamBoard({ org, project, team: source.team, sprint: source.sprint });
      if (!board.ok) return board;
      const item: TeamBoardItem | undefined = board.data.items.find((candidate) => candidate.id === source.id);
      if (!item) return refusal('not-found', `#${source.id} is no longer on the ${board.data.sprint.name} board — refreshed`);
      let pullRequest: ActivePullRequest | null = null;
      if (request.lane === 'code-review' && item.pullRequestId !== null) {
        const prs = await ado.activePrs({ org, project, team: source.team });
        if (!prs.ok) return prs;
        pullRequest = prs.data.pullRequests.find((pr) => pr.id === item.pullRequestId) ?? null;
        if (!pullRequest) return refusal('not-found', `The linked PR !${item.pullRequestId} is no longer open — refreshed`);
      }
      return ok({
        card: {
          kind: 'board-item',
          id: item.id,
          column: item.columnKind,
          assignee: item.assignee,
          agentLane: await agentLaneOf(item.id),
          pullRequestId: item.pullRequestId,
          branch: item.branch,
        },
        title: item.title,
        project,
        workItem: { id: item.id, columnName: item.column },
        pullRequest,
      });
    }
    if (source.kind === 'backlog-item') {
      const item = await ado.getWorkItem({ org, id: source.id });
      if (!item.ok) return item;
      if (item.data.stateCategory === 'completed' || item.data.stateCategory === 'removed') {
        return refusal('not-found', `#${source.id} is ${item.data.state} now — refreshed`);
      }
      const assignee = item.data.assignedTo;
      return ok({
        card: {
          kind: 'backlog-item',
          id: item.data.id,
          assignee: assignee ? { id: null, uniqueName: assignee.uniqueName ?? null, displayName: assignee.displayName } : null,
          agentLane: await agentLaneOf(item.data.id),
        },
        title: item.data.title,
        project: item.data.project,
        workItem: { id: item.data.id, columnName: null },
        pullRequest: null,
      });
    }
    const prs = await ado.activePrs({ org, project, ...(source.team === undefined ? {} : { team: source.team }) });
    if (!prs.ok) return prs;
    const pr = prs.data.pullRequests.find((candidate) => candidate.id === source.id);
    if (!pr) return refusal('not-found', `!${source.id} is no longer open — refreshed`);
    return ok({
      card: { kind: 'pull-request', id: pr.id, author: pr.author, unresolvedThreads: pr.unresolvedThreads, sourceBranch: pr.sourceBranch, repoRegistered: pr.repoRegistered },
      title: pr.title,
      project: pr.repository.projectName,
      workItem: null,
      pullRequest: pr,
    });
  }

  /** The verdict's refusal as the user sees it: where the card moved, or the rule's reason. */
  function refused(request: LaunchFromAdoRequest, fresh: FreshCard, reason: string): Err {
    if (reason === DROP_REFUSALS.addRepo) {
      return refusal('add-repo', `!${fresh.card.id}'s repository ${fresh.pullRequest?.repository.name ?? ''} isn't registered in Agent Lanes. Add repo to review it.`.replace('  ', ' '), {
        repository: fresh.pullRequest?.repository.name ?? null,
      });
    }
    const { source } = request;
    const column = fresh.workItem?.columnName ?? null;
    if (source.kind === 'board-item' && source.column !== undefined && column !== null && column.toLowerCase() !== source.column.toLowerCase()) {
      return refusal('moved', `Moved to ${column} — refreshed`, { column });
    }
    return refusal('refused', reason);
  }

  function gatesFor(action: DropAction, overrides: StageGates | undefined): StageGates {
    const gates: StageGates = { ...settings.get().defaults.stageGates };
    // Planning keeps the plan gate; Implementing skips it (T5).
    if (action.planGate !== null) gates.planning = action.planGate ? 'approval' : 'auto';
    return { ...gates, ...overrides };
  }

  function repoFor(request: LaunchFromAdoRequest): string | null {
    const current = settings.get();
    const wanted = request.repo ?? current.ui.lastRepo;
    const found = current.repos.find((repo) => repo.path === wanted) ?? (request.repo === undefined ? current.repos[0] : undefined);
    return found?.path ?? null;
  }

  async function assign(client: AdoClient, project: string, workItemId: number, me: AdoPerson & { id: string }): Promise<Result<{ before: WorkItemAssignment; after: WorkItemAssignment }>> {
    const before = await getWorkItemAssignment(client, { project, workItemId });
    if (!before.ok) return before;
    const state = await inProgressStateOf(client, project, before.data.type);
    if (!state.ok) return state;
    const after = await setWorkItemAssignment(client, { project, workItemId }, { expectedRev: before.data.rev, assignee: me.uniqueName ?? me.displayName, state: state.data });
    return after.ok ? ok({ before: before.data, after: after.data }) : after;
  }

  function worktreeInput(request: LaunchFromAdoRequest, fresh: FreshCard, action: DropAction, repo: string, orgUrl: string, defaults: Pick<DropAction, 'skills' | 'model' | 'effort'>): CreateTicketWorktreeInput {
    const overrides = request.overrides ?? {};
    const common = {
      repo,
      model: overrides.model ?? defaults.model,
      effort: overrides.effort ?? defaults.effort,
      gates: gatesFor(action, overrides.gates),
      skills: [...new Set((overrides.skills ?? defaults.skills).map(skillName))],
      stage: 'queued' as const,
    };
    const pr = fresh.pullRequest;
    if (pr && (action.worktree === 'pr-source-branch' || action.worktree === 'pr-branch-read-only')) {
      const review = action.worktree === 'pr-branch-read-only';
      return {
        ...common,
        subject: { kind: 'pull-request', pullRequestId: pr.id, title: `!${pr.id} ${pr.title}`, purpose: review ? 'review' : 'answer' },
        checkout: { branch: pr.sourceBranch, detached: review },
        baseBranch: pr.targetBranch,
      };
    }
    const workItemId = fresh.workItem?.id ?? fresh.card.id;
    const branch = fresh.card.kind === 'board-item' ? fresh.card.branch : null;
    return {
      ...common,
      subject: { kind: 'work-item', ado: { orgUrl, project: fresh.project, workItemId }, title: fresh.title },
      ...(action.worktree === 'item-branch' && branch ? { checkout: { branch } } : {}),
    };
  }

  /** What the agent is asked to do first, per lane (TB§3); AL-238 adds the PR review and comment payloads. */
  function jobFor(action: DropAction, fresh: FreshCard): string {
    const id = fresh.workItem ? `#${fresh.workItem.id}` : `!${fresh.card.id}`;
    switch (action.worktree) {
      case 'pr-branch-read-only':
        return `Review pull request ${id} (${fresh.title}) on its source branch. This worktree is read-only: change no files and push nothing.`;
      case 'pr-source-branch':
        return `Work through the open comment threads on your pull request ${id} (${fresh.title}) on its source branch.`;
      default:
        break;
    }
    if (action.lane === 'qa') return `QA work item ${id} on its branch: build it and check each acceptance criterion.`;
    if (action.lane === 'implementing') return `Plan and implement work item ${id}. No plan approval is needed: go straight on to building it.`;
    return `Read work item ${id}, explore the code, and write a plan. Ask for plan approval before implementing.`;
  }

  function summaryOf(fresh: FreshCard, lane: Lane, change: LaunchAdoChange | null, queued: boolean): string {
    const what = fresh.workItem ? `#${fresh.workItem.id}` : `!${fresh.card.id}`;
    const where = queued ? 'agent queued for a free slot' : `agent started in ${LANE_NAMES[lane]}`;
    return change ? `${what} assigned to you and moved to ${change.state === 'Active' ? 'In Progress' : change.state} · ${where}` : `${what} · ${where}`;
  }

  async function launch(request: LaunchFromAdoRequest): Promise<Result<LaunchFromAdoResponse>> {
    const connection = await connectionFor(request.org);
    const client = await ado.clientFor(connection?.id ?? request.org);
    if (!client.ok) return client;
    if (!connection) return err('ADO_UNAUTHORIZED', 'No Azure DevOps organisation is connected. Add one in Connections.', { reason: 'not-connected' });
    const project = request.project ?? connection.defaultProject;
    if (!project) return err('VALIDATION', `Choose a default project for ${connection.name} in Connections.`, { org: connection.id, reason: 'no-project' });

    const identity = await getSignedInUser(client.data);
    if (!identity.ok) return identity;
    const me: DropMe = { id: identity.data.id, uniqueName: identity.data.uniqueName };

    // 1. The card as it is now, and the rules again.
    const fresh = await readCard(request, connection.id, project);
    if (!fresh.ok) return fresh;
    const verdict = dropVerdict(fresh.data.card, request.lane, me);
    if (!verdict.ok) return refused(request, fresh.data, verdict.refusal.reason);
    const action = verdict.action;

    const scope = scopeFor(action);
    if (scope && connection.missingScopes.includes(scope)) {
      return err('ADO_SCOPE_MISSING', `The Azure DevOps token for ${connection.name} is missing the ${ADO_SCOPE_LABELS[scope]} (read & write) scope this drop needs.`, {
        org: connection.id,
        scope,
        reason: 'scope-missing',
      });
    }

    const repo = fresh.data.pullRequest && action.worktree.startsWith('pr-') ? await options.repoForPullRequest(client.data.orgUrl, fresh.data.pullRequest) : repoFor(request);
    if (!repo) {
      return fresh.data.pullRequest
        ? refused(request, fresh.data, DROP_REFUSALS.addRepo)
        : refusal('no-repo', 'Add a repo in Settings before launching an agent: the worktree is made in it.');
    }

    // The first turn reads the work item's description and acceptance criteria.
    let sessionItem: SessionWorkItem | null = null;
    if (fresh.data.workItem) {
      const item = await ado.getWorkItem({ org: connection.id, id: fresh.data.workItem.id });
      if (!item.ok) return item;
      const text = [item.data.description, item.data.acceptanceCriteria ? `<p>Acceptance criteria:</p>${item.data.acceptanceCriteria}` : null].filter(Boolean).join('\n');
      sessionItem = { id: item.data.id, title: item.data.title, type: item.data.type, state: item.data.state, description: text || null };
    }

    // 2. The only ADO change a drop makes (T5).
    let restoreInfo: AdoRestore | null = null;
    let adoChange: LaunchAdoChange | null = null;
    if (action.changesAdo && fresh.data.workItem) {
      const changed = await assign(client.data, fresh.data.project, fresh.data.workItem.id, identity.data);
      if (!changed.ok) return changed;
      const { before, after } = changed.data;
      restoreInfo = { project: fresh.data.project, workItemId: before.workItemId, previousAssignee: before.assignee, previousState: before.state, rev: after.rev };
      adoChange = { workItemId: before.workItemId, previousAssignee: before.assignee?.displayName ?? null, previousState: before.state, state: after.state };
    }

    const rollBackAdo = async (): Promise<Record<string, unknown>> => {
      if (!restoreInfo) return {};
      const restored = await restoreAssignment(client.data, restoreInfo);
      if (!restored.ok) log?.warn(`Could not put #${restoreInfo.workItemId} back after a failed launch: ${restored.message}`);
      return { adoRestored: restored.ok, ...(restored.ok ? {} : { adoRestoreError: restored.message }) };
    };

    // 3. The worktree and the ticket.
    const defaults = options.laneDefaults?.(action) ?? action;
    const created = await worktrees
      .create(worktreeInput(request, fresh.data, action, repo, client.data.orgUrl, defaults))
      .catch((cause: unknown) => err('INTERNAL', cause instanceof Error ? cause.message : String(cause)));
    if (!created.ok) {
      const rolledBack = await rollBackAdo();
      return err(created.code, created.message, { ...(isRecord(created.details) ? created.details : {}), ...rolledBack });
    }
    const ticketId = created.data.record.id;

    // 4. The session, entering the dropped lane as it starts (or Queued at the cap).
    startLanes.set(ticketId, request.lane);
    const started = await launches
      .launch({ ticketId, jobDescription: jobFor(action, fresh.data), workItem: sessionItem })
      .catch((cause: unknown) => err('INTERNAL', cause instanceof Error ? cause.message : String(cause)));
    if (!started.ok) {
      startLanes.delete(ticketId);
      const discarded = await worktrees.discard(ticketId);
      const rolledBack = await rollBackAdo();
      log?.warn(`Launch of ${ticketId} from the team board failed (${started.message}); rolled back`);
      return err(started.code, started.message, {
        ...(isRecord(started.details) ? started.details : {}),
        ticketId,
        rollback: discarded.ok ? discarded.data : { complete: false, leftovers: [discarded.message] },
        ...rolledBack,
      });
    }

    const record: TicketRecord = (await tickets.get(ticketId)) ?? created.data.record;
    const undoId = randomBytes(24).toString('hex');
    undo.set(undoId, { undoId, ticketId, lane: request.lane, org: connection.id, ado: restoreInfo, review: isReview(action), createdAt: now() });
    log?.info(`Launched ${ticketId} on ${request.lane} from the team board${adoChange ? ` (assigned #${adoChange.workItemId}, moved to ${adoChange.state})` : ''}`);
    return ok({
      ticketId,
      record,
      status: started.data,
      adoChange,
      undoId,
      summary: summaryOf(fresh.data, request.lane, adoChange, started.data.state === 'queued'),
    });
  }

  return {
    launch: (request) => {
      const key = `${request.source.kind === 'pull-request' ? 'pr' : 'wi'}:${request.source.id}`;
      return perCard(key, () =>
        launch(request).catch((cause: unknown) => err('INTERNAL', `Launching from Azure DevOps failed unexpectedly: ${cause instanceof Error ? cause.message : String(cause)}`)),
      );
    },
    startLane: (ticketId) => startLanes.get(ticketId),
    undoEntryForTicket: (ticketId) => [...undo.values()].find((entry) => entry.ticketId === ticketId),
    undoEntry: (undoId) => undo.get(undoId),
    forgetUndo: (undoId) => void undo.delete(undoId),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Puts a work item's assignee and state back (AL-237 Undo uses it too). */
export async function restoreAssignment(client: AdoClient, change: AdoRestore): Promise<Result<void>> {
  const restored = await setWorkItemAssignment(
    client,
    { project: change.project, workItemId: change.workItemId },
    { expectedRev: change.rev, assignee: change.previousAssignee ? (change.previousAssignee.uniqueName ?? change.previousAssignee.displayName) : null, state: change.previousState },
  );
  return restored.ok ? ok(undefined) : restored;
}
