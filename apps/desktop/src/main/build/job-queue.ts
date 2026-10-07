import { randomUUID } from 'node:crypto';
import { posix, win32 } from 'node:path';
import type { BuildJob, BuildJobKind, BuildQueuedEvent } from '@agent-lanes/contracts';

/**
 * Build and run job queue (design §10, AL-131). Builds and the build step of runs go through here so
 * a machine running several agents is not swamped: at most `concurrency` jobs run at once (the
 * "build queue size" setting, 2 by default), and a worktree never has two jobs at the same time.
 *
 * - **FIFO:** waiting jobs start in the order they were queued. A job whose worktree is busy lets the
 *   jobs behind it for other worktrees go first, then starts as soon as its worktree is free.
 * - **Cancellation:** a waiting job is removed at once and never runs. A running job's `signal`
 *   aborts; its slot and worktree are released when its `run` settles, so a child process is never
 *   overlapped by the next job in the same worktree.
 * - **Status:** every change of a job's queue status (queued with its position, position moved,
 *   running, finished, cancelled) goes to `subscribe` listeners as a `build:queued` event payload.
 *
 * The queue does not spawn anything itself; the build and run jobs (AL-132, AL-133) do the work in
 * `run` and own their child processes.
 */

export const DEFAULT_BUILD_CONCURRENCY = 2;

/** How long `dispose` waits for running jobs to settle after aborting them. */
const DEFAULT_DISPOSE_GRACE_MS = 5_000;

export interface JobRequest<T> {
  ticketId: string;
  /** The ticket's worktree. Jobs for the same worktree never overlap. */
  worktreePath: string;
  kind: BuildJobKind;
  /**
   * The work, started once the job has a slot and its worktree is free; both are held until the
   * returned promise settles. `signal` aborts when the job is cancelled while running: stop the
   * child process and settle.
   */
  run(signal: AbortSignal): Promise<T>;
}

/** How a job ended. `error` means `run` threw; a build that found compile errors still `finished`. */
export type JobOutcome<T> = { status: 'finished'; value: T } | { status: 'error'; error: unknown } | { status: 'cancelled' };

export interface EnqueuedJob<T> {
  readonly jobId: string;
  /** Settles once the job finished, threw or was cancelled. Never rejects. */
  readonly outcome: Promise<JobOutcome<T>>;
}

export type JobQueueListener = (event: BuildQueuedEvent) => void;

export interface JobQueue {
  /** Queues a job. It starts straight away when a slot is free and its worktree is idle. */
  enqueue<T>(request: JobRequest<T>): EnqueuedJob<T>;
  /** Removes a waiting job, or aborts a running one. False when the job is unknown or already final. */
  cancel(jobId: string): boolean;
  /** Running jobs first (in start order), then waiting jobs in queue order. */
  list(): BuildJob[];
  /** Jobs allowed to run at once, as currently read from settings. */
  concurrency(): number;
  /** Re-reads the concurrency and starts waiting jobs that now fit. Call after the setting changes. */
  refresh(): void;
  /** Receives every queue status change; returns the unsubscribe function. */
  subscribe(listener: JobQueueListener): () => void;
  /** Cancels every job (app quit) and waits up to `graceMs` for running ones to settle. New jobs are cancelled. */
  dispose(options?: { graceMs?: number }): Promise<void>;
}

export interface JobQueueOptions {
  /** Jobs allowed to run at once, read whenever a slot may be filled (settings `buildQueueSize`). */
  concurrency?: () => number;
  /** Clock for timestamps; tests pass a fixed one. */
  now?: () => number;
  /** Job id factory; defaults to random UUIDs. */
  createId?: () => string;
  /** Decides how worktree paths compare (case-insensitive on Windows). Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** Where a failing listener is reported. Defaults to `console.error`. */
  log?: (message: string, cause: unknown) => void;
}

interface Entry {
  readonly job: BuildJob;
  readonly worktreeKey: string;
  readonly run: (signal: AbortSignal) => Promise<unknown>;
  readonly controller: AbortController;
  readonly outcome: Promise<JobOutcome<unknown>>;
  readonly resolve: (outcome: JobOutcome<unknown>) => void;
  cancelRequested: boolean;
}

/** One key per worktree folder, however the path was spelled (`C:\al\AL-1` = `c:/al/AL-1/` on Windows). */
export function worktreeKey(path: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? win32.resolve(path).toLowerCase() : posix.resolve(path);
}

export function createJobQueue(options: JobQueueOptions = {}): JobQueue {
  const now = options.now ?? Date.now;
  const createId = options.createId ?? randomUUID;
  const platform = options.platform ?? process.platform;
  const log = options.log ?? ((message, cause) => console.error(`[build-queue] ${message}`, cause));

  const waiting: Entry[] = [];
  const running = new Map<string, Entry>();
  const busyWorktrees = new Set<string>();
  const listeners = new Set<JobQueueListener>();
  let disposed = false;

  function readConcurrency(): number {
    let value: number;
    try {
      value = options.concurrency?.() ?? DEFAULT_BUILD_CONCURRENCY;
    } catch (cause) {
      log('Could not read the build queue size; using the default', cause);
      return DEFAULT_BUILD_CONCURRENCY;
    }
    return Number.isFinite(value) && value >= 1 ? Math.floor(value) : DEFAULT_BUILD_CONCURRENCY;
  }

  function notify(entry: Entry): void {
    const event: BuildQueuedEvent = { ...entry.job, at: now() };
    for (const listener of listeners) {
      try {
        listener({ ...event });
      } catch (cause) {
        log(`A listener failed on job ${entry.job.jobId}`, cause);
      }
    }
  }

  /** Starts waiting jobs, oldest first, while there are free slots; skips jobs whose worktree is busy. */
  function schedule(): void {
    if (disposed) return;
    const limit = readConcurrency();
    for (const entry of [...waiting]) {
      if (running.size >= limit) break;
      if (busyWorktrees.has(entry.worktreeKey)) continue;
      waiting.splice(waiting.indexOf(entry), 1);
      start(entry);
    }
  }

  /** Tells listeners about waiting jobs whose place in the queue changed (including newly queued ones). */
  function publishPositions(): void {
    waiting.forEach((entry, index) => {
      const position = index + 1;
      if (entry.job.position === position) return;
      entry.job.position = position;
      notify(entry);
    });
  }

  function update(): void {
    schedule();
    publishPositions();
  }

  function start(entry: Entry): void {
    entry.job.state = 'running';
    entry.job.position = null;
    entry.job.startedAt = now();
    running.set(entry.job.jobId, entry);
    busyWorktrees.add(entry.worktreeKey);
    notify(entry);

    // Run outside the scheduling pass so a job that calls back into the queue sees a settled state.
    void Promise.resolve()
      .then(() => (entry.cancelRequested ? undefined : entry.run(entry.controller.signal)))
      .then(
        (value) => settle(entry, entry.cancelRequested ? { status: 'cancelled' } : { status: 'finished', value }),
        (error: unknown) => settle(entry, entry.cancelRequested ? { status: 'cancelled' } : { status: 'error', error }),
      );
  }

  function settle(entry: Entry, outcome: JobOutcome<unknown>): void {
    running.delete(entry.job.jobId);
    busyWorktrees.delete(entry.worktreeKey);
    finish(entry, outcome);
    update();
  }

  function finish(entry: Entry, outcome: JobOutcome<unknown>): void {
    entry.job.state = outcome.status === 'cancelled' ? 'cancelled' : 'finished';
    entry.job.position = null;
    entry.job.finishedAt = now();
    notify(entry);
    entry.resolve(outcome);
  }

  function removeWaiting(entry: Entry): void {
    waiting.splice(waiting.indexOf(entry), 1);
    finish(entry, { status: 'cancelled' });
  }

  return {
    enqueue<T>(request: JobRequest<T>): EnqueuedJob<T> {
      if (!request.ticketId) throw new TypeError('A job needs a ticket id');
      if (!request.worktreePath) throw new TypeError('A job needs a worktree path');

      let resolve!: (outcome: JobOutcome<unknown>) => void;
      const outcome = new Promise<JobOutcome<unknown>>((done) => (resolve = done));
      const entry: Entry = {
        job: {
          jobId: createId(),
          ticketId: request.ticketId,
          kind: request.kind,
          state: 'queued',
          position: null,
          queuedAt: now(),
          startedAt: null,
          finishedAt: null,
        },
        worktreeKey: worktreeKey(request.worktreePath, platform),
        run: (signal) => request.run(signal),
        controller: new AbortController(),
        outcome,
        resolve,
        cancelRequested: false,
      };

      if (disposed) {
        entry.cancelRequested = true;
        entry.job.state = 'cancelled';
        entry.job.finishedAt = entry.job.queuedAt;
        resolve({ status: 'cancelled' });
      } else {
        waiting.push(entry);
        update();
      }

      return { jobId: entry.job.jobId, outcome: outcome as Promise<JobOutcome<T>> };
    },

    cancel(jobId) {
      const queued = waiting.find((entry) => entry.job.jobId === jobId);
      if (queued) {
        removeWaiting(queued);
        update();
        return true;
      }

      const active = running.get(jobId);
      if (!active) return false;
      if (!active.cancelRequested) {
        active.cancelRequested = true;
        active.controller.abort();
      }
      return true;
    },

    list() {
      return [...running.values(), ...waiting].map((entry) => ({ ...entry.job }));
    },

    concurrency: readConcurrency,

    refresh: update,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async dispose({ graceMs = DEFAULT_DISPOSE_GRACE_MS } = {}) {
      disposed = true;
      for (const entry of [...waiting]) removeWaiting(entry);

      const active = [...running.values()];
      for (const entry of active) {
        entry.cancelRequested = true;
        entry.controller.abort();
      }
      if (active.length === 0) return;

      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<void>((done) => {
        timer = setTimeout(done, graceMs);
        timer.unref();
      });
      await Promise.race([Promise.all(active.map((entry) => entry.outcome)), timeout]);
      clearTimeout(timer);
    },
  };
}
