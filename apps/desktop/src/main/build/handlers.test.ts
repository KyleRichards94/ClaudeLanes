import { defaultSettings, err, ok } from '@agent-lanes/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { handleInvoke } from '../ipc/handle-invoke';
import { createBuildCommands } from './commands';
import { createBuildHandlers } from './handlers';
import { createJobQueue, type JobQueue } from './job-queue';

let queue: JobQueue;

function handlers(concurrency = 2) {
  queue = createJobQueue({ concurrency: () => concurrency, platform: 'win32' });
  return createBuildHandlers({
    buildQueue: queue,
    buildCommands: createBuildCommands({ settings: { get: defaultSettings } }),
    builds: { build: (ticketId) => Promise.resolve(err('VALIDATION', 'No ticket ' + ticketId)), isStale: () => Promise.resolve(true) },
    runs: { start: (ticketId) => Promise.resolve(err('VALIDATION', 'No ticket ' + ticketId)), list: () => [], openUrl: () => Promise.resolve(ok({ opened: false })),
      stop: () => Promise.resolve(ok({ stopped: false })),
      dispose: () => Promise.resolve(),
    },
  });
}

/** A job that runs until the test disposes the queue. */
function enqueueBuild(ticketId: string) {
  return queue.enqueue({
    ticketId,
    worktreePath: `C:\\al\\${ticketId}`,
    kind: 'build',
    run: (signal) => new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve())),
  });
}

afterEach(async () => {
  await queue.dispose({ graceMs: 0 });
});

describe('build IPC handlers', () => {
  it('build:listJobs returns the concurrency and the running and waiting jobs', async () => {
    const build = handlers(2);
    enqueueBuild('AL-1');
    enqueueBuild('AL-2');
    enqueueBuild('AL-3');

    const result = await handleInvoke('build:listJobs', undefined, build['build:listJobs']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.concurrency).toBe(2);
    expect(result.data.jobs.map((job) => [job.ticketId, job.state, job.position])).toEqual([
      ['AL-1', 'running', null],
      ['AL-2', 'running', null],
      ['AL-3', 'queued', 1],
    ]);
  });

  it('build:cancel removes a waiting job', async () => {
    const build = handlers(1);
    enqueueBuild('AL-1');
    const waiting = enqueueBuild('AL-2');

    await expect(handleInvoke('build:cancel', { jobId: waiting.jobId }, build['build:cancel'])).resolves.toEqual({
      ok: true,
      data: { cancelled: true },
    });
    await expect(waiting.outcome).resolves.toEqual({ status: 'cancelled' });
    expect(queue.list().map((job) => job.ticketId)).toEqual(['AL-1']);

    await expect(handleInvoke('build:cancel', { jobId: waiting.jobId }, build['build:cancel'])).resolves.toEqual({
      ok: true,
      data: { cancelled: false },
    });
  });

  it('build:cancel refuses a request without a job id', async () => {
    const build = handlers();
    const result = await handleInvoke('build:cancel', { jobId: '' }, build['build:cancel']);
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('build:commands refuses a repo that is not registered', async () => {
    const build = handlers();
    const result = await handleInvoke('build:commands', { repoPath: 'C:\\src\\nowhere' }, build['build:commands']);
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
  });
});
