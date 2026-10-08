import { DEFAULT_MAX_CONCURRENT_AGENTS, ok, type AgentSessionStatus, type Result } from '@agent-lanes/contracts';
import type { Emit } from '../ipc/emit';
import type { Logger } from '../logging';
import type { TicketRecordStore } from '../tickets';
import type { SessionManager, SessionStartRequest } from './session-manager';

/**
 * The per-repo concurrency cap and the Queued lane (AL-111, design §13 "a per-repo cap on concurrent
 * agents, and a queued lane", Q5). Every session start goes through here: while a repo has fewer live
 * sessions than its `maxConcurrentAgents` setting (3 by default) the session starts; otherwise the
 * launch waits in the repo's queue with "Waiting for a free slot", and the oldest waiting launch starts
 * as soon as a session of that repo ends (FIFO). "Start now" starts one at once, over the cap.
 *
 * A session counts against the cap while its `claude` process is live (`starting`, `running`, `idle`
 * or `paused`): an idle session still holds its process and its context.
 */
export interface LaunchQueue {
  /** Starts the ticket's session, or queues it when its repo is at the cap (state `queued`). */
  launch(request: SessionStartRequest): Promise<Result<AgentSessionStatus>>;
  /**
   * Starts a lost session again (AL-110 Reconnect). Ahead of every waiting launch: it starts when a slot
   * is free, else it waits at the front of the queue. `onStarted` runs once it has started.
   */
  restart(ticketId: string, onStarted?: () => void): Promise<Result<AgentSessionStatus>>;
  /** "Start now": starts a queued ticket at once, over the cap. A ticket that is not queued is started as `launch` would. */
  startNow(ticketId: string): Promise<Result<AgentSessionStatus>>;
  /** Takes a ticket out of the queue (e.g. it was archived). True when it was queued. */
  cancel(ticketId: string): boolean;
  /** The ticket's session status; `queued` with "Waiting for a free slot" while it waits. */
  status(ticketId: string): AgentSessionStatus;
  /** The queued ticket ids of a repo, oldest first. */
  queued(repo: string): string[];
  /** Starts waiting launches that now fit: after a session ends, or the cap was raised. */
  refresh(): Promise<void>;
}

export interface LaunchQueueOptions {
  sessions: Pick<SessionManager, 'start' | 'status' | 'list'>;
  tickets: Pick<TicketRecordStore, 'get'>;
  /** The repo's `maxConcurrentAgents` setting, read at each decision. */
  maxAgents: (repo: string) => number;
  emit: Emit;
  log?: Pick<Logger, 'info' | 'warn'>;
}

/** The queued card's activity line (artboard 1). */
export const QUEUED_MESSAGE = 'Waiting for a free slot';

const LIVE = new Set<AgentSessionStatus['state']>(['starting', 'running', 'idle', 'paused']);

interface Waiting {
  request: SessionStartRequest;
  repo: string;
  sessionId: string | null;
  onStarted?: () => void;
}

export function createLaunchQueue(options: LaunchQueueOptions): LaunchQueue {
  const { sessions, tickets, emit, log } = options;
  /** Waiting launches, oldest first, across repos. */
  const waiting: Waiting[] = [];
  /** The repo of every ticket this queue has seen, so counting live sessions needs no reads. */
  const repoOf = new Map<string, string>();
  /** Start decisions run one at a time, so two launches never both take the last slot. */
  let chain: Promise<unknown> = Promise.resolve();

  function serial<T>(work: () => Promise<T>): Promise<T> {
    const next = chain.then(work, work);
    chain = next.catch(() => undefined);
    return next;
  }

  async function repoFor(ticketId: string): Promise<string | null> {
    const known = repoOf.get(ticketId);
    if (known) return known;
    const record = await tickets.get(ticketId);
    if (!record) return null;
    repoOf.set(ticketId, record.repo);
    return record.repo;
  }

  async function liveIn(repo: string): Promise<number> {
    let count = 0;
    for (const status of sessions.list()) {
      if (LIVE.has(status.state) && (await repoFor(status.ticketId)) === repo) count += 1;
    }
    return count;
  }

  const cap = (repo: string): number => {
    const value = options.maxAgents(repo);
    return Number.isInteger(value) && value >= 1 ? value : DEFAULT_MAX_CONCURRENT_AGENTS;
  };

  const queuedStatus = (entry: Waiting): AgentSessionStatus => ({
    ticketId: entry.request.ticketId,
    state: 'queued',
    sessionId: entry.sessionId,
    message: QUEUED_MESSAGE,
  });

  function enqueue(entry: Waiting, front = false): AgentSessionStatus {
    if (front) waiting.unshift(entry);
    else waiting.push(entry);
    const status = queuedStatus(entry);
    emit('agent:status', status);
    log?.info(`Queued ticket ${entry.request.ticketId}: ${entry.repo} is at its cap of ${cap(entry.repo)} agents`);
    return status;
  }

  function take(ticketId: string): Waiting | undefined {
    const index = waiting.findIndex((entry) => entry.request.ticketId === ticketId);
    return index === -1 ? undefined : waiting.splice(index, 1)[0];
  }

  async function startEntry(entry: Waiting): Promise<Result<AgentSessionStatus>> {
    const started = await sessions.start(entry.request);
    if (started.ok) entry.onStarted?.();
    else log?.warn(`Could not start ticket ${entry.request.ticketId}: ${started.message}`);
    return started;
  }

  /** Starts the oldest waiting launches of each repo while the repo has a free slot. Runs inside `serial`. */
  async function drain(): Promise<void> {
    for (let index = 0; index < waiting.length; ) {
      const entry = waiting[index]!;
      if ((await liveIn(entry.repo)) >= cap(entry.repo)) {
        index += 1;
        continue;
      }
      waiting.splice(index, 1);
      await startEntry(entry);
    }
  }

  async function admit(request: SessionStartRequest, front: boolean, onStarted?: () => void): Promise<Result<AgentSessionStatus>> {
    const { ticketId } = request;
    const already = waiting.find((entry) => entry.request.ticketId === ticketId);
    if (already) return ok(queuedStatus(already));
    if (LIVE.has(sessions.status(ticketId).state)) return sessions.start(request);
    const repo = await repoFor(ticketId);
    // An unknown ticket: the session manager says so.
    if (repo === null) return sessions.start(request);
    const entry: Waiting = { request, repo, sessionId: sessions.status(ticketId).sessionId, ...(onStarted ? { onStarted } : {}) };
    // FIFO: a new launch waits behind the ones already queued for its repo.
    const ahead = !front && waiting.some((other) => other.repo === repo);
    if (ahead || (await liveIn(repo)) >= cap(repo)) return ok(enqueue(entry, front));
    return startEntry(entry);
  }

  return {
    launch: (request) => serial(() => admit(request, false)),
    restart: (ticketId, onStarted) => serial(() => admit({ ticketId }, true, onStarted)),

    startNow: (ticketId) =>
      serial(async () => {
        const entry = take(ticketId);
        if (!entry) return admit({ ticketId }, false);
        log?.info(`Starting queued ticket ${ticketId} now, over the cap`);
        return startEntry(entry);
      }),

    cancel(ticketId) {
      const entry = take(ticketId);
      if (!entry) return false;
      emit('agent:status', { ...sessions.status(ticketId), ticketId });
      return true;
    },

    status(ticketId) {
      const entry = waiting.find((item) => item.request.ticketId === ticketId);
      return entry ? queuedStatus(entry) : sessions.status(ticketId);
    },

    queued: (repo) => waiting.filter((entry) => entry.repo === repo).map((entry) => entry.request.ticketId),

    refresh: () => serial(drain),
  };
}
