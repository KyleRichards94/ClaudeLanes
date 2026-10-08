import { isAgentLanesComment, repoAdoWriteBack, type Lane, type Stage } from '@agent-lanes/contracts';
import type { ConnectionsService } from '../connections';
import type { Logger } from '../logging';
import type { SettingsService } from '../settings/service';
import type { TicketRecordStore } from '../tickets';
import { repoPathKey } from '../repos/repo-paths';
import type { WorkItemWriteBack } from './write-back';

/**
 * ADO write-back on stage change (AL-115, design §7 "ADO write-back"): each time a ticket with a work
 * item moves to another lane, one short comment goes to the work item's discussion, e.g.
 * "Agent Lanes · Implementing — plan approved by Kyle".
 *
 * - Off switch per repo: Settings › Repos › "Post stage comments to Azure DevOps" (`adoWriteBack`,
 *   on unless turned off), read when the comment is about to be posted.
 * - Rate-limited: comments to one work item go one at a time, at least `minIntervalMs` apart, and at
 *   most `maxPending` wait per work item (older waiting ones are dropped, the newest is kept).
 * - Never duplicated: each stage entry (ticket, lane, time it was entered) is posted once, and before
 *   posting the work item's discussion is read: when its newest Agent Lanes comment already says the
 *   same thing (a resumed session announcing the stage it was in), nothing is posted.
 */
export interface StageComments {
  /** A ticket entered `to`; queues its comment. Never throws and never waits for ADO. */
  stageChanged(change: StageCommentChange): void;
  /** Resolves when every queued comment has been posted or given up. */
  idle(): Promise<void>;
}

export interface StageCommentChange {
  ticketId: string;
  from: Lane;
  to: Lane;
  /** When the ticket entered `to` (its stage history entry). */
  at: number;
  /** The agent's summary of the move; the card's activity line. */
  summary: string | null;
  /** The gate the move waited on and who approved it; absent when it was not gated. */
  gate?: { stage: Stage; by: string | null };
}

export interface StageCommentsOptions {
  tickets: Pick<TicketRecordStore, 'get'>;
  settings: Pick<SettingsService, 'get'>;
  writeBack: Pick<WorkItemWriteBack, 'comment' | 'comments'>;
  /** The Connections id (`ado:contoso`) of the organisation a work item lives in; undefined when it isn't connected. */
  orgFor(orgUrl: string): Promise<string | undefined>;
  log?: Pick<Logger, 'info' | 'warn'>;
  minIntervalMs?: number;
  maxPending?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const STAGE_COMMENT_MIN_INTERVAL_MS = 5_000;
export const STAGE_COMMENT_MAX_PENDING = 10;

const LANE_NAMES: Record<Lane, string> = {
  queued: 'Queued',
  planning: 'Planning',
  implementing: 'Implementing',
  'code-review': 'Code review',
  qa: 'QA',
  'create-pr': 'Create PR',
  done: 'Done',
};

/** What the gate approved, as the comment says it ("plan approved by Kyle"). */
const GATE_WORDS: Record<Stage, string> = {
  planning: 'plan',
  implementing: 'implementation',
  'code-review': 'code review',
  qa: 'QA',
  'create-pr': 'PR',
};

const SUMMARY_LIMIT = 200;

/** "Implementing — plan approved by Kyle", "Code review — Grid and filters done", "QA". Without the prefix. */
export function stageCommentText(change: Pick<StageCommentChange, 'to' | 'summary' | 'gate'>): string {
  const lane = LANE_NAMES[change.to];
  if (change.gate) return `${lane} — ${GATE_WORDS[change.gate.stage]} approved${change.gate.by ? ` by ${change.gate.by}` : ' (gate switched off)'}`;
  const summary = change.summary?.replace(/\s+/g, ' ').trim();
  if (!summary) return lane;
  return `${lane} — ${summary.length > SUMMARY_LIMIT ? `${summary.slice(0, SUMMARY_LIMIT - 1)}…` : summary}`;
}

/** A comment's words without markup or entities, for comparing what was posted with what would be. */
function plain(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&middot;|&#183;/gi, '·')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

interface Pending {
  key: string;
  ticketId: string;
  text: string;
}

export function createStageComments(options: StageCommentsOptions): StageComments {
  const { tickets, settings, writeBack, log } = options;
  const minIntervalMs = options.minIntervalMs ?? STAGE_COMMENT_MIN_INTERVAL_MS;
  const maxPending = options.maxPending ?? STAGE_COMMENT_MAX_PENDING;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  /** Stage entries already posted or queued, so one entry is never posted twice. */
  const handled = new Set<string>();
  /** Per work item: what waits, and the loop posting it. */
  const queues = new Map<string, { items: Pending[]; running: Promise<void> | undefined; lastPostedAt: number }>();
  /** Work started and not finished: queuing steps and posting loops. */
  const inFlight = new Set<Promise<unknown>>();
  function track<T>(work: Promise<T>): Promise<T> {
    inFlight.add(work);
    void work.finally(() => inFlight.delete(work)).catch(() => undefined);
    return work;
  }

  async function post(item: Pending, workItemKey: string): Promise<void> {
    const record = await tickets.get(item.ticketId);
    if (!record?.ado) return;
    const repo = settings.get().repos.find((entry) => repoPathKey(entry.path) === repoPathKey(record.repo));
    if (repo && !repoAdoWriteBack(repo)) {
      log?.info(`Stage comments are off for ${repo.name}; not posting to #${record.ado.workItemId}`);
      return;
    }
    const org = await options.orgFor(record.ado.orgUrl);
    if (!org) {
      log?.warn(`No connected Azure DevOps organisation for ${workItemKey}; the stage comment was not posted`);
      return;
    }
    const target = { org, project: record.ado.project, workItemId: record.ado.workItemId };
    const existing = await writeBack.comments(target);
    if (existing.ok) {
      const newest = existing.data.filter((comment) => comment.fromAgentLanes || isAgentLanesComment(comment.text)).at(-1);
      if (newest && plain(newest.text).endsWith(plain(item.text))) {
        log?.info(`#${target.workItemId} already says "${item.text}"; not posting it again`);
        return;
      }
    }
    const posted = await writeBack.comment(target, item.text);
    if (posted.ok) log?.info(`Posted "${item.text}" to #${target.workItemId}`);
    else log?.warn(`Could not post the stage comment to #${target.workItemId}: ${posted.message}`);
  }

  async function drain(workItemKey: string): Promise<void> {
    const queue = queues.get(workItemKey);
    if (!queue) return;
    for (let item = queue.items.shift(); item; item = queue.items.shift()) {
      const wait = queue.lastPostedAt + minIntervalMs - now();
      if (queue.lastPostedAt > 0 && wait > 0) await sleep(wait);
      try {
        await post(item, workItemKey);
      } catch (error) {
        log?.warn(`The stage comment for ${item.ticketId} failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      queue.lastPostedAt = now();
    }
    queue.running = undefined;
  }

  return {
    stageChanged(change) {
      if (change.from === change.to) return;
      const key = `${change.ticketId}\n${change.to}\n${change.at}`;
      if (handled.has(key)) return;
      handled.add(key);
      const enqueue = async () => {
        const record = await tickets.get(change.ticketId);
        if (!record?.ado) return;
        const workItemKey = `${record.ado.orgUrl.toLowerCase()}#${record.ado.workItemId}`;
        const queue = queues.get(workItemKey) ?? { items: [], running: undefined, lastPostedAt: 0 };
        queues.set(workItemKey, queue);
        queue.items.push({ key, ticketId: change.ticketId, text: stageCommentText(change) });
        if (queue.items.length > maxPending) {
          const dropped = queue.items.splice(0, queue.items.length - maxPending);
          log?.warn(`Dropped ${dropped.length} stage comment(s) for ${workItemKey}: too many stage changes at once`);
        }
        queue.running ??= track(drain(workItemKey));
      };
      void track(enqueue()).catch((error: unknown) =>
        log?.warn(`Could not queue the stage comment for ${change.ticketId}: ${error instanceof Error ? error.message : String(error)}`),
      );
    },

    async idle() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
  };
}

/** The Connections id of the ADO organisation at `orgUrl` (compared without case or a trailing slash). */
export async function adoConnectionIdFor(connections: Pick<ConnectionsService, 'list'>, orgUrl: string): Promise<string | undefined> {
  const key = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();
  const found = (await connections.list()).find((connection) => connection.kind === 'ado' && key(connection.orgUrl) === key(orgUrl));
  return found?.id;
}
