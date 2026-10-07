import { BuildQueuedEventSchema, type BuildJobKind, type BuildQueuedEvent } from '@agent-lanes/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BUILD_CONCURRENCY, createJobQueue, worktreeKey, type JobQueue, type JobQueueOptions } from './job-queue';

/** A job whose `run` the test finishes by hand. */
interface FakeJob {
  readonly jobId: string;
  readonly outcome: ReturnType<JobQueue['enqueue']>['outcome'];
  /** Times `run` was called. */
  readonly started: () => number;
  readonly signal: () => AbortSignal | undefined;
  finish(value?: string): Promise<void>;
  fail(error: Error): Promise<void>;
}

let queues: JobQueue[] = [];
let events: BuildQueuedEvent[] = [];
let clock = 1_000;

function openQueue(options: JobQueueOptions = {}): JobQueue {
  const queue = createJobQueue({ now: () => clock++, platform: 'win32', ...options });
  queue.subscribe((event) => events.push(event));
  queues.push(queue);
  return queue;
}

/** Lets queued microtasks run (jobs start and settle on promise callbacks). */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function enqueue(queue: JobQueue, ticketId: string, worktreePath = `C:\\al\\${ticketId}`, kind: BuildJobKind = 'build'): FakeJob {
  let calls = 0;
  let signal: AbortSignal | undefined;
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const done = new Promise<string>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const job = queue.enqueue({
    ticketId,
    worktreePath,
    kind,
    run: (abort) => {
      calls += 1;
      signal = abort;
      return done;
    },
  });

  return {
    jobId: job.jobId,
    outcome: job.outcome,
    started: () => calls,
    signal: () => signal,
    async finish(value = `${ticketId} built`) {
      resolve(value);
      await flush();
    },
    async fail(error) {
      reject(error);
      await flush();
    },
  };
}

function states(queue: JobQueue): Array<[string, string, number | null]> {
  return queue.list().map((job) => [job.ticketId, job.state, job.position]);
}

function eventsFor(jobId: string): Array<[string, number | null]> {
  return events.filter((event) => event.jobId === jobId).map((event) => [event.state, event.position]);
}

afterEach(async () => {
  await Promise.all(queues.map((queue) => queue.dispose({ graceMs: 0 })));
  queues = [];
  events = [];
  clock = 1_000;
});

describe('JobQueue', () => {
  it('runs two builds at once by default; the third waits for a free slot', async () => {
    const queue = openQueue();
    const a = enqueue(queue, 'AL-1');
    const b = enqueue(queue, 'AL-2');
    const c = enqueue(queue, 'AL-3');
    await flush();

    expect(queue.concurrency()).toBe(DEFAULT_BUILD_CONCURRENCY);
    expect(states(queue)).toEqual([
      ['AL-1', 'running', null],
      ['AL-2', 'running', null],
      ['AL-3', 'queued', 1],
    ]);
    expect([a.started(), b.started(), c.started()]).toEqual([1, 1, 0]);

    await a.finish();
    expect(c.started()).toBe(1);
    expect(states(queue)).toEqual([
      ['AL-2', 'running', null],
      ['AL-3', 'running', null],
    ]);
    await expect(a.outcome).resolves.toEqual({ status: 'finished', value: 'AL-1 built' });
  });

  it('removes a cancelled waiting job; it never runs and its place is given up', async () => {
    const queue = openQueue();
    const a = enqueue(queue, 'AL-1');
    enqueue(queue, 'AL-2');
    const c = enqueue(queue, 'AL-3');
    const d = enqueue(queue, 'AL-4');
    await flush();
    expect(states(queue).map(([ticket]) => ticket)).toEqual(['AL-1', 'AL-2', 'AL-3', 'AL-4']);

    expect(queue.cancel(c.jobId)).toBe(true);
    await expect(c.outcome).resolves.toEqual({ status: 'cancelled' });
    expect(states(queue)).toEqual([
      ['AL-1', 'running', null],
      ['AL-2', 'running', null],
      ['AL-4', 'queued', 1],
    ]);
    expect(eventsFor(c.jobId)).toEqual([
      ['queued', 1],
      ['cancelled', null],
    ]);
    // AL-4 moved up into the cancelled job's place.
    expect(eventsFor(d.jobId)).toEqual([
      ['queued', 2],
      ['queued', 1],
    ]);

    await a.finish();
    expect(c.started()).toBe(0);
    expect(d.started()).toBe(1);
    expect(queue.cancel(c.jobId)).toBe(false);
  });

  it('starts waiting jobs in the order they were queued', async () => {
    const queue = openQueue({ concurrency: () => 1 });
    const jobs = ['AL-1', 'AL-2', 'AL-3', 'AL-4'].map((ticketId) => enqueue(queue, ticketId));
    await flush();
    expect(states(queue).map(([, state, position]) => [state, position])).toEqual([
      ['running', null],
      ['queued', 1],
      ['queued', 2],
      ['queued', 3],
    ]);

    for (const [index, job] of jobs.entries()) {
      expect(jobs.map((each) => each.started())).toEqual(jobs.map((_, other) => (other <= index ? 1 : 0)));
      await job.finish();
    }
    expect(queue.list()).toEqual([]);
  });

  it('never runs two jobs in the same worktree at once, however the path is spelled', async () => {
    const queue = openQueue({ concurrency: () => 3 });
    const build = enqueue(queue, 'AL-1', 'C:\\al\\AL-1', 'build');
    const run = enqueue(queue, 'AL-1', 'c:/al/al-1/', 'run');
    const other = enqueue(queue, 'AL-2', 'C:\\al\\AL-2');
    await flush();

    // AL-2 overtakes the job that is waiting for its worktree, without taking its place in line.
    expect(states(queue)).toEqual([
      ['AL-1', 'running', null],
      ['AL-2', 'running', null],
      ['AL-1', 'queued', 1],
    ]);
    expect(run.started()).toBe(0);

    await other.finish();
    expect(run.started()).toBe(0);

    await build.finish();
    expect(run.started()).toBe(1);
    expect(queue.list().map((job) => job.kind)).toEqual(['run']);
  });

  it('compares worktree paths case-insensitively on Windows only', () => {
    expect(worktreeKey('C:\\al\\AL-1', 'win32')).toBe(worktreeKey('c:/AL/al-1/', 'win32'));
    expect(worktreeKey('/home/al/AL-1', 'linux')).toBe(worktreeKey('/home/al/AL-1/', 'linux'));
    expect(worktreeKey('/home/al/AL-1', 'linux')).not.toBe(worktreeKey('/home/al/al-1', 'linux'));
  });

  it('takes its concurrency from the setting and applies a change on refresh', async () => {
    let size = 2;
    const queue = openQueue({ concurrency: () => size });
    const a = enqueue(queue, 'AL-1');
    const b = enqueue(queue, 'AL-2');
    const c = enqueue(queue, 'AL-3');
    const d = enqueue(queue, 'AL-4');
    await flush();
    expect(c.started()).toBe(0);

    size = 3;
    queue.refresh();
    await flush();
    expect(queue.concurrency()).toBe(3);
    expect(c.started()).toBe(1);
    expect(d.started()).toBe(0);

    // Lowering the size lets running jobs finish; nothing new starts until the count is below it.
    size = 1;
    await a.finish();
    await b.finish();
    expect(d.started()).toBe(0);
    await c.finish();
    expect(d.started()).toBe(1);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('falls back to the default for a size of %s', (size) => {
    const queue = openQueue({ concurrency: () => size });
    expect(queue.concurrency()).toBe(DEFAULT_BUILD_CONCURRENCY);
  });

  it('aborts a cancelled running job and holds its worktree until it has stopped', async () => {
    const queue = openQueue();
    const a = enqueue(queue, 'AL-1');
    const next = enqueue(queue, 'AL-1', 'C:\\al\\AL-1', 'run');
    await flush();
    expect(a.signal()?.aborted).toBe(false);

    expect(queue.cancel(a.jobId)).toBe(true);
    expect(a.signal()?.aborted).toBe(true);
    await flush();
    expect(next.started()).toBe(0);
    expect(states(queue)[0]).toEqual(['AL-1', 'running', null]);

    await a.fail(new Error('killed'));
    await expect(a.outcome).resolves.toEqual({ status: 'cancelled' });
    expect(eventsFor(a.jobId).at(-1)).toEqual(['cancelled', null]);
    expect(next.started()).toBe(1);
  });

  it('does not start a job cancelled before its run was called', async () => {
    const queue = openQueue();
    const a = enqueue(queue, 'AL-1');
    expect(queue.cancel(a.jobId)).toBe(true);
    await flush();
    expect(a.started()).toBe(0);
    await expect(a.outcome).resolves.toEqual({ status: 'cancelled' });
  });

  it('frees the slot when a job throws and reports the error', async () => {
    const queue = openQueue({ concurrency: () => 1 });
    const a = enqueue(queue, 'AL-1');
    const b = enqueue(queue, 'AL-2');
    await flush();

    const error = new Error('spawn dotnet ENOENT');
    await a.fail(error);
    await expect(a.outcome).resolves.toEqual({ status: 'error', error });
    expect(eventsFor(a.jobId).at(-1)).toEqual(['finished', null]);
    expect(b.started()).toBe(1);
  });

  it('reports every status change as a valid build:queued payload without the worktree path', async () => {
    const queue = openQueue({ concurrency: () => 1 });
    const a = enqueue(queue, 'AL-1');
    const b = enqueue(queue, 'AL-2', 'C:\\al\\AL-2', 'run');
    await flush();
    await a.finish();
    await b.finish();

    expect(eventsFor(a.jobId)).toEqual([
      ['running', null],
      ['finished', null],
    ]);
    expect(eventsFor(b.jobId)).toEqual([
      ['queued', 1],
      ['running', null],
      ['finished', null],
    ]);

    for (const event of events) {
      expect(BuildQueuedEventSchema.parse(event)).toEqual(event);
      expect(event).not.toHaveProperty('worktreePath');
      expect(Object.values(event)).not.toContain('C:\\al\\AL-2');
    }
    const finished = events.at(-1);
    expect(finished).toMatchObject({ ticketId: 'AL-2', kind: 'run', state: 'finished' });
    expect(finished?.queuedAt).toBeLessThan(finished?.startedAt ?? 0);
    expect(finished?.startedAt).toBeLessThan(finished?.finishedAt ?? 0);
  });

  it('keeps going when a listener throws', async () => {
    const log = vi.fn();
    const queue = openQueue({ log });
    queue.subscribe(() => {
      throw new Error('listener bug');
    });
    const a = enqueue(queue, 'AL-1');
    await flush();
    await a.finish();

    await expect(a.outcome).resolves.toMatchObject({ status: 'finished' });
    expect(log).toHaveBeenCalled();
  });

  it('stops notifying a listener after it unsubscribes', async () => {
    const queue = openQueue();
    const seen: string[] = [];
    const unsubscribe = queue.subscribe((event) => seen.push(event.state));
    const a = enqueue(queue, 'AL-1');
    unsubscribe();
    await a.finish();
    expect(seen).toEqual(['running']);
  });

  it('cancels everything on dispose and refuses new jobs afterwards', async () => {
    const queue = openQueue();
    const a = enqueue(queue, 'AL-1');
    const b = enqueue(queue, 'AL-2');
    const c = enqueue(queue, 'AL-3');
    await flush();
    a.signal()?.addEventListener('abort', () => void a.fail(new Error('aborted')));
    b.signal()?.addEventListener('abort', () => void b.finish());

    await queue.dispose();
    await expect(Promise.all([a.outcome, b.outcome, c.outcome])).resolves.toEqual([
      { status: 'cancelled' },
      { status: 'cancelled' },
      { status: 'cancelled' },
    ]);
    expect(c.started()).toBe(0);
    expect(queue.list()).toEqual([]);

    const late = enqueue(queue, 'AL-4');
    await flush();
    expect(late.started()).toBe(0);
    await expect(late.outcome).resolves.toEqual({ status: 'cancelled' });
  });

  it('stops waiting on dispose after the grace period when a job ignores its signal', async () => {
    const queue = openQueue();
    const stuck = enqueue(queue, 'AL-1');
    await flush();

    await queue.dispose({ graceMs: 10 });
    expect(stuck.signal()?.aborted).toBe(true);
  });

  it('returns false when cancelling an unknown job', () => {
    expect(openQueue().cancel('no-such-job')).toBe(false);
  });
});
