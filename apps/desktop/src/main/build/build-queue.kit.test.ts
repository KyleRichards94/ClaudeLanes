import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ok, type BuildQueuedEvent, type BuildResult, type RepoCommands } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGitService } from '../git/git-service';
import { createTempRepo, recordingEmit, type TempRepo } from '../testing';
import { createTicketRecordStore, type TicketRecordStore } from '../tickets';
import { createMemoryRecordFs, newTicketInput } from '../tickets/testing';
import { createBuildService, type BuildService } from './build-service';
import { createGitFingerprint } from './freshness';
import { createJobQueue, type JobQueue } from './job-queue';

/**
 * The build queue on the main-process test kit (AL-221): real ticket worktrees in a temp repo, a real
 * build command (a node script committed to the repo) and the real queue, build service and git
 * fingerprint. Only the ticket records are in memory.
 */

// Git calls and the build's shell are process spawns (slow on Windows with antivirus).
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** Logs when it starts and ends to `builds.log` at the temp repo root, and fails while `fail.txt` exists. */
const BUILD_SCRIPT = `import { appendFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
const log = join(process.cwd(), '..', '..', 'builds.log');
const name = basename(process.cwd());
appendFileSync(log, 'start ' + name + '\\n');
await new Promise((resolve) => setTimeout(resolve, 150));
console.log('Building ' + name);
appendFileSync(log, 'end ' + name + '\\n');
if (existsSync('fail.txt')) {
  console.log("src/app.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.");
  process.exit(1);
}
`;

let repo: TempRepo;
let tickets: TicketRecordStore;
let queue: JobQueue;
let builds: BuildService;
let queued: BuildQueuedEvent[];
let worktrees: Record<string, string>;

beforeEach(async () => {
  repo = await createTempRepo();
  await repo.write('build.mjs', BUILD_SCRIPT);
  await repo.commit('Add build script');
  worktrees = {
    '71273': await repo.addWorktree('71273-cutover-job-control'),
    '71274': await repo.addWorktree('71274-fix-date-filter'),
  };

  tickets = createTicketRecordStore({ rootDir: join(repo.root, 'user-data', 'tickets'), fs: createMemoryRecordFs(), warn: () => undefined });
  for (const [id, worktreePath] of Object.entries(worktrees)) {
    const created = await tickets.create(newTicketInput(repo.root, { id, repo: repo.dir, worktreePath }));
    if (!created.ok) throw new Error(created.message);
  }

  queue = createJobQueue({ concurrency: () => 1 });
  queued = [];
  queue.subscribe((event) => queued.push(event));
  const commands: RepoCommands = { repoPath: repo.dir, detected: null, build: { command: 'node build.mjs', origin: 'detected' }, run: null };
  builds = createBuildService({
    tickets,
    buildCommands: { forRepo: () => Promise.resolve(ok(commands)) },
    queue,
    emit: recordingEmit().emit,
    logBatchMs: 10,
    warn: () => undefined,
    fingerprint: createGitFingerprint(createGitService({ runner: repo.git })),
  });
});

afterEach(async () => {
  await queue?.dispose({ graceMs: 5_000 });
  await tickets?.dispose();
  await repo?.cleanup();
});

describe('build queue on temp repo worktrees', () => {
  it('runs one build at a time with a queue size of 1, the second waiting as Queued', async () => {
    const [first, second] = await Promise.all([builds.build('71273'), builds.build('71274')]);

    expect(first).toMatchObject({ ok: true, data: { outcome: 'succeeded', exitCode: 0 } });
    expect(second).toMatchObject({ ok: true, data: { outcome: 'succeeded', exitCode: 0 } });
    const log = (await readFile(join(repo.root, 'builds.log'), 'utf8')).trim().split('\n');
    expect(log).toEqual(['start 71273-cutover-job-control', 'end 71273-cutover-job-control', 'start 71274-fix-date-filter', 'end 71274-fix-date-filter']);
    expect(queued.filter((event) => event.ticketId === '71274').map((event) => event.state)).toContain('queued');
    expect(queued.find((event) => event.ticketId === '71274' && event.state === 'queued')?.position).toBe(1);
  });

  it('reports BUILD_FAILED from the real build output and saves it on the ticket', async () => {
    await repo.write('fail.txt', 'x', worktrees['71273']);

    const result = await builds.build('71273');

    expect(result).toMatchObject({ ok: false, code: 'BUILD_FAILED' });
    const details = (result as { details: BuildResult }).details;
    expect(details).toMatchObject({ outcome: 'failed', exitCode: 1, errors: 1 });
    expect(details.diagnostics[0]).toMatchObject({ code: 'TS2322', file: 'src/app.ts' });
    expect((await tickets.get('71273'))?.lastBuild).toMatchObject({ outcome: 'failed', errors: 1 });
  });

  it('keeps a successful build fresh until the worktree changes', async () => {
    expect(await builds.isStale('71273')).toBe(true);
    await builds.build('71273');
    expect(await builds.isStale('71273')).toBe(false);

    await repo.write('src/JobControl.razor', '<h1>Jobs</h1>\n', worktrees['71273']);
    expect(await builds.isStale('71273')).toBe(true);
    expect(await builds.isStale('71274')).toBe(true);
  });
});
