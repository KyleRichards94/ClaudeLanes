import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCardState,
  defaultStageGates,
  ok,
  type BuildLogEvent,
  type BuildResult,
  type EventChannel,
  type EventInput,
  type RepoCommands,
  type Result,
  type TicketRecord,
} from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Emit } from '../ipc/emit';
import { createTicketRecord } from '../tickets';
import { createBuildService, type BuildServiceOptions } from './build-service';
import { createJobQueue, type JobQueue } from './job-queue';
import type { CommandExit, StartCommand, StartCommandOptions } from './process/start-command';

const WORKTREE = join(tmpdir(), 'agent-lanes-build-service-71273');

function record(overrides: Partial<TicketRecord> = {}): TicketRecord {
  return {
    ...createTicketRecord(
      {
        id: '71273',
        title: 'Cutover frmJobControl to Blazor',
        ado: null,
        repo: 'C:\\src\\onsite',
        baseBranch: 'main',
        branch: '71273-cutover',
        worktreePath: WORKTREE,
        model: 'opus',
        effort: 'xhigh',
        gates: defaultStageGates(),
        skills: [],
      },
      1_000,
    ),
    ...overrides,
  };
}

function commands(build: string | null): RepoCommands {
  return { repoPath: 'C:\\src\\onsite', detected: null, build: build ? { command: build, origin: 'detected' } : null, run: null };
}

interface Emitted {
  channel: EventChannel;
  payload: unknown;
}

/** A fake child process: the test prints lines and ends it. */
function fakeProcess() {
  const started: StartCommandOptions[] = [];
  const exits: ((exit: CommandExit) => void)[] = [];
  const kill = vi.fn(() => {
    exits.at(-1)?.({ exitCode: null, signal: 'SIGTERM' });
    return Promise.resolve();
  });
  const start: StartCommand = (options) => {
    started.push(options);
    return { pid: 4242, exit: new Promise<CommandExit>((resolve) => exits.push(resolve)), kill };
  };
  return {
    start,
    started,
    kill,
    print(text: string, stream: 'stdout' | 'stderr' = 'stdout') {
      started.at(-1)!.onLine(stream, text);
    },
    exit(exitCode: number) {
      exits.at(-1)!({ exitCode, signal: null });
    },
  };
}

let queue: JobQueue;
let emitted: Emitted[];
let stored: TicketRecord;

function service(overrides: Partial<BuildServiceOptions> = {}) {
  queue = createJobQueue({ concurrency: () => 2, platform: 'win32' });
  emitted = [];
  const emit = ((channel: EventChannel, payload: EventInput<EventChannel>) => emitted.push({ channel, payload })) as Emit;
  stored = record();
  let clock = 10_000;
  return createBuildService({
    tickets: {
      get: (id) => Promise.resolve(id === stored.id ? stored : undefined),
      update: (id, change) => {
        stored = change(stored);
        return Promise.resolve(ok(stored));
      },
    },
    buildCommands: { forRepo: () => Promise.resolve(ok(commands('dotnet build OnSite.sln -c Debug'))) },
    queue,
    emit,
    now: () => (clock += 1_000),
    logBatchMs: 10,
    folderExists: () => Promise.resolve(true),
    warn: vi.fn(),
    ...overrides,
  });
}

function events<C extends EventChannel>(channel: C): EventInput<C>[] {
  return emitted.filter((event) => event.channel === channel).map((event) => event.payload as EventInput<C>);
}

afterEach(async () => {
  await queue?.dispose({ graceMs: 0 });
});

describe('build service', () => {
  it('fails with BUILD_FAILED and the counts, and the card shows "Build failed · 3 errors" with the first error', async () => {
    const child = fakeProcess();
    const builds = service({ startCommand: child.start });

    const pending = builds.build('71273');
    await vi.waitFor(() => expect(child.started).toHaveLength(1));
    expect(child.started[0]).toMatchObject({ command: 'dotnet build OnSite.sln -c Debug', cwd: WORKTREE });

    child.print('Build started.');
    child.print("JobControl.razor.cs(42,17): error CS0246: The type or namespace name 'JobFilterState' could not be found [OnSite.csproj]");
    child.print("JobGrid.razor.cs(8,3): error CS0103: The name 'grid' does not exist in the current context [OnSite.csproj]");
    child.print('Filters.cs(1,1): warning CS0168: The variable \'e\' is declared but never used [OnSite.csproj]');
    child.print('Startup.cs(9,9): error CS1002: ; expected [OnSite.csproj]', 'stderr');
    child.print('Build FAILED.');
    child.print("JobControl.razor.cs(42,17): error CS0246: The type or namespace name 'JobFilterState' could not be found [OnSite.csproj]");
    child.exit(1);

    const result = (await pending) as Extract<Result<BuildResult>, { ok: false }>;
    expect(result).toMatchObject({ ok: false, code: 'BUILD_FAILED', message: 'Build failed · 3 errors' });
    const details = result.details as BuildResult;
    expect(details).toMatchObject({ ticketId: '71273', kind: 'build', outcome: 'failed', exitCode: 1, errors: 3, warnings: 1 });

    expect(stored.lastBuild).toMatchObject({ outcome: 'failed', errors: 3, warnings: 1, firstError: { code: 'CS0246' } });
    expect(buildCardState(stored.lastBuild)).toEqual({ footer: 'Build failed · 3 errors', activity: 'CS0246: JobFilterState not found' });

    const finished = events('build:finished');
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ ticketId: '71273', outcome: 'failed', errors: 3, jobId: details.jobId });
  });

  it('streams the log as batched build:log events with levels', async () => {
    const child = fakeProcess();
    const builds = service({ startCommand: child.start });
    const pending = builds.build('71273');
    await vi.waitFor(() => expect(child.started).toHaveLength(1));

    for (let i = 0; i < 50; i += 1) child.print(`  line ${i}`);
    child.print('\u001b[31mA.cs(1,1): error CS1002: ; expected\u001b[0m');
    child.exit(1);
    await pending;

    const batches = events('build:log') as BuildLogEvent[];
    expect(batches.length).toBeGreaterThanOrEqual(1);
    expect(batches.length).toBeLessThan(10);
    const lines = batches.flatMap((batch) => batch.lines);
    expect(lines).toHaveLength(51);
    expect(lines.at(-1)).toEqual({ text: 'A.cs(1,1): error CS1002: ; expected', stream: 'stdout', level: 'error' });
    expect(new Set(batches.map((batch) => batch.jobId)).size).toBe(1);
  });

  it('succeeds with ok and stores "Last build · succeeded" on the ticket', async () => {
    const child = fakeProcess();
    const builds = service({ startCommand: child.start });
    const pending = builds.build('71273');
    await vi.waitFor(() => expect(child.started).toHaveLength(1));
    child.print('Build succeeded.');
    child.exit(0);

    const result = await pending;
    expect(result).toMatchObject({ ok: true, data: { outcome: 'succeeded', errors: 0, exitCode: 0 } });
    expect(stored.lastBuild).toMatchObject({ outcome: 'succeeded', errors: 0, firstError: null });
    expect(stored.lastBuild!.finishedAt).toBeGreaterThan(stored.lastBuild!.startedAt);
  });

  it('kills the process when the job is cancelled and reports it cancelled', async () => {
    const child = fakeProcess();
    const builds = service({ startCommand: child.start });
    const pending = builds.build('71273');
    await vi.waitFor(() => expect(child.started).toHaveLength(1));

    const [job] = queue.list();
    expect(queue.cancel(job!.jobId)).toBe(true);

    await expect(pending).resolves.toMatchObject({ ok: true, data: { outcome: 'cancelled', exitCode: null } });
    expect(child.kill).toHaveBeenCalledOnce();
    expect(stored.lastBuild?.outcome).toBe('cancelled');
  });

  it('refuses unknown tickets, repos without a build command and missing worktrees', async () => {
    const child = fakeProcess();
    await expect(service({ startCommand: child.start }).build('99999')).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
    await expect(
      service({ startCommand: child.start, buildCommands: { forRepo: () => Promise.resolve(ok(commands(null))) } }).build('71273'),
    ).resolves.toMatchObject({ ok: false, code: 'VALIDATION', message: expect.stringContaining('no build command') });
    await expect(service({ startCommand: child.start, folderExists: () => Promise.resolve(false) }).build('71273')).resolves.toMatchObject({
      ok: false,
      code: 'VALIDATION',
    });
    expect(child.started).toHaveLength(0);
  });
});

describe('build service with a real process', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agent-lanes-build-real-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('runs the command in the worktree through the shell and parses what it prints', async () => {
    writeFileSync(
      join(dir, 'build.js'),
      [
        "console.log('Building ' + require('path').basename(process.cwd()));",
        "console.log('src/a.ts(3,5): error TS2322: Type \\'string\\' is not assignable to type \\'number\\'.');",
        "console.error('src/b.ts(1,1): warning TS6133: \\'x\\' is declared but its value is never read.');",
        'process.exit(2);',
      ].join('\n'),
    );
    const builds = service({
      buildCommands: { forRepo: () => Promise.resolve(ok(commands('node build.js'))) },
      folderExists: undefined,
    });
    stored = record({ worktreePath: dir });

    const result = await builds.build('71273');
    expect(result).toMatchObject({ ok: false, code: 'BUILD_FAILED', message: 'Build failed · 1 error' });
    const details = (result as { details: BuildResult }).details;
    expect(details).toMatchObject({ exitCode: 2, errors: 1, warnings: 1 });
    const lines = (events('build:log') as BuildLogEvent[]).flatMap((batch) => batch.lines);
    expect(lines).toContainEqual({ text: expect.stringMatching(/^Building agent-lanes-build-real-/), stream: 'stdout', level: 'info' });
    expect(lines).toContainEqual(expect.objectContaining({ stream: 'stderr', level: 'warning' }));
  });

  it('fails cleanly when the command does not exist', async () => {
    const builds = service({
      buildCommands: { forRepo: () => Promise.resolve(ok(commands('agent-lanes-no-such-tool --build'))) },
      folderExists: undefined,
    });
    stored = record({ worktreePath: dir });

    const result = await builds.build('71273');
    expect(result).toMatchObject({ ok: false, code: 'BUILD_FAILED' });
    expect((result as { details: BuildResult }).details.exitCode).not.toBe(0);
  });
});
