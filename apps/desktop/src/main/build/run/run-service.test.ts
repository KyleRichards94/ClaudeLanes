import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  defaultStageGates,
  err,
  ok,
  runLabel,
  type BuildResult,
  type DetectedCommands,
  type EventChannel,
  type EventInput,
  type RepoCommands,
  type RunStatus,
  type TicketRecord,
} from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { Emit } from '../../ipc/emit';
import { createTicketRecord } from '../../tickets';
import type { CommandExit, StartCommand, StartCommandOptions } from '../process/start-command';
import { createRunService, type RunServiceOptions } from './run-service';

const WORKTREE = join(tmpdir(), 'agent-lanes-run-service-71273');

const web: DetectedCommands = {
  toolchain: 'dotnet',
  manifest: 'OnSite.sln',
  packageManager: null,
  build: 'dotnet build OnSite.sln -c Debug',
  run: 'dotnet run --project Web/Web.csproj',
  runTarget: 'Web/Web.csproj',
  runKind: 'web',
};
const desktop: DetectedCommands = { ...web, run: 'dotnet run --project WinExe/WinExe.csproj', runTarget: 'WinExe/WinExe.csproj', runKind: 'desktop' };

function commandsFor(detected: DetectedCommands, override: string | null = null): RepoCommands {
  return {
    repoPath: 'C:\\src\\onsite',
    detected,
    build: detected.build ? { command: detected.build, origin: 'detected' } : null,
    run: override ? { command: override, origin: 'override' } : { command: detected.run!, origin: 'detected' },
  };
}

function ticket(): TicketRecord {
  return createTicketRecord(
    {
      id: '71273',
      title: 'Cutover',
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
    1,
  );
}

function builtResult(outcome: BuildResult['outcome']): BuildResult {
  return { jobId: 'b1', ticketId: '71273', kind: 'run', outcome, command: 'dotnet build', exitCode: 0, errors: 0, warnings: 0, diagnostics: [], startedAt: 1, finishedAt: 2 };
}

function fakeProcesses() {
  const started: StartCommandOptions[] = [];
  const exits: ((exit: CommandExit) => void)[] = [];
  const start: StartCommand = (options) => {
    started.push(options);
    return { pid: 100 + started.length, exit: new Promise<CommandExit>((resolve) => exits.push(resolve)), kill: () => Promise.resolve() };
  };
  return { start, started, exits };
}

function setup(overrides: Partial<RunServiceOptions> & { detected?: DetectedCommands; override?: string | null; stale?: boolean } = {}) {
  const emitted: { channel: EventChannel; payload: unknown }[] = [];
  const emit = ((channel: EventChannel, payload: EventInput<EventChannel>) => emitted.push({ channel, payload })) as Emit;
  let stored = ticket();
  const processes = fakeProcesses();
  const builds = {
    build: vi.fn(() => Promise.resolve(ok(builtResult('succeeded')))),
    isStale: vi.fn(() => Promise.resolve(overrides.stale ?? true)),
  };
  let nextPort = 5080;
  const openExternal = vi.fn(() => Promise.resolve());
  let id = 0;
  const service = createRunService({
    tickets: {
      get: (ticketId) => Promise.resolve(ticketId === stored.id ? stored : undefined),
      update: (_, change) => {
        stored = change(stored);
        return Promise.resolve(ok(stored));
      },
    },
    buildCommands: { forRepo: () => Promise.resolve(ok(commandsFor(overrides.detected ?? web, overrides.override ?? null))) },
    builds,
    emit,
    openExternal,
    startCommand: processes.start,
    ports: { allocate: () => Promise.resolve(nextPort++), release: vi.fn() },
    isListening: () => Promise.resolve(false),
    createId: () => `run-${++id}`,
    folderExists: () => Promise.resolve(true),
    probeIntervalMs: 5,
    warn: vi.fn(),
    ...overrides,
  });
  const statuses = () => emitted.filter((event) => event.channel === 'run:status').map((event) => event.payload as RunStatus);
  return { service, processes, builds, openExternal, statuses, emitted, stored: () => stored };
}

describe('run service', () => {
  it('builds when stale, starts on a free port and shows "Running · localhost:5080" once the app prints its URL', async () => {
    const { service, processes, builds, statuses, stored } = setup();

    const started = await service.start('71273');
    expect(builds.build).toHaveBeenCalledWith('71273', { kind: 'run' });
    expect(started).toMatchObject({ ok: true, data: { state: 'starting', port: 5080, runKind: 'web', url: null } });

    const [options] = processes.started;
    expect(options!.cwd).toBe(WORKTREE);
    expect(options!.env).toMatchObject({ ASPNETCORE_URLS: 'http://localhost:5080', PORT: '5080' });
    // A launch profile can't move a detected dotnet web project off its port.
    expect(options!.command).toBe('dotnet run --project Web/Web.csproj -- --urls=http://localhost:5080');

    options!.onLine('stdout', 'info: Microsoft.Hosting.Lifetime[14]');
    options!.onLine('stdout', '      Now listening on: http://localhost:5080');

    const last = statuses().at(-1)!;
    expect(last).toMatchObject({ state: 'running', url: 'http://localhost:5080/' });
    expect(runLabel(last)).toBe('Running · localhost:5080');
    expect(statuses().map((status) => status.state)).toEqual(['building', 'starting', 'running']);
    await vi.waitFor(() => expect(stored().lastRun).toMatchObject({ url: 'http://localhost:5080/', stoppedAt: null }));
  });

  it('skips the build when the last build is still fresh', async () => {
    const { service, builds } = setup({ stale: false });
    await service.start('71273');
    expect(builds.build).not.toHaveBeenCalled();
  });

  it('fails with BUILD_FAILED and starts nothing when the build step fails', async () => {
    const { service, processes, builds, statuses } = setup();
    builds.build.mockResolvedValueOnce(err('BUILD_FAILED', 'Build failed · 3 errors', builtResult('failed')) as never);

    await expect(service.start('71273')).resolves.toMatchObject({ ok: false, code: 'BUILD_FAILED' });
    expect(processes.started).toHaveLength(0);
    expect(statuses().at(-1)).toMatchObject({ state: 'failed', message: 'Build failed · 3 errors' });
  });

  it('starts a desktop app without a port and counts it running at once', async () => {
    const { service, processes } = setup({ detected: desktop });
    await expect(service.start('71273')).resolves.toMatchObject({ ok: true, data: { state: 'running', port: null, url: null, runKind: 'desktop' } });
    expect(processes.started[0]!.env).toEqual({});
    expect(processes.started[0]!.command).toBe('dotnet run --project WinExe/WinExe.csproj');
  });

  it('leaves an override command line alone but still passes the port in the environment', async () => {
    const { service, processes } = setup({ override: 'dotnet watch run' });
    await service.start('71273');
    expect(processes.started[0]!.command).toBe('dotnet watch run');
    expect(processes.started[0]!.env).toMatchObject({ PORT: '5080' });
  });

  it('returns the current status when the ticket is already running', async () => {
    const { service, processes } = setup({ detected: desktop });
    const first = await service.start('71273');
    const second = await service.start('71273');
    expect(processes.started).toHaveLength(1);
    expect(second).toEqual(first);
  });

  it('finds the URL by probing the port when the app prints none', async () => {
    let listening = false;
    const { service, statuses } = setup({ isListening: () => Promise.resolve(listening) });
    await service.start('71273');
    listening = true;
    await vi.waitFor(() => expect(statuses().at(-1)).toMatchObject({ state: 'running', url: 'http://localhost:5080/' }));
  });

  it('reports a crash as failed with its exit code, and a clean exit as stopped', async () => {
    const crash = setup();
    await crash.service.start('71273');
    crash.processes.exits[0]!({ exitCode: 3, signal: null });
    await vi.waitFor(() => expect(crash.statuses().at(-1)).toMatchObject({ state: 'failed', exitCode: 3, message: 'The app exited with code 3' }));
    await vi.waitFor(() => expect(crash.stored().lastRun).toMatchObject({ exitCode: 3 }));
    expect(crash.service.list()).toEqual([expect.objectContaining({ ticketId: '71273', state: 'failed' })]);

    const clean = setup({ detected: desktop });
    await clean.service.start('71273');
    clean.processes.exits[0]!({ exitCode: 0, signal: null });
    await vi.waitFor(() => expect(clean.statuses().at(-1)).toMatchObject({ state: 'stopped', exitCode: 0 }));
  });

  it('opens the running URL in the browser, and nothing without one', async () => {
    const { service, processes, openExternal } = setup();
    await expect(service.openUrl('71273')).resolves.toEqual({ ok: true, data: { opened: false } });
    await service.start('71273');
    await expect(service.openUrl('71273')).resolves.toEqual({ ok: true, data: { opened: false } });
    processes.started[0]!.onLine('stdout', 'Now listening on: http://localhost:5080');
    await expect(service.openUrl('71273')).resolves.toEqual({ ok: true, data: { opened: true } });
    expect(openExternal).toHaveBeenCalledWith('http://localhost:5080/');
  });

  it('refuses a ticket without a run command', async () => {
    const { service } = setup({ buildCommands: { forRepo: () => Promise.resolve(ok({ ...commandsFor(web), run: null })) } });
    await expect(service.start('71273')).resolves.toMatchObject({ ok: false, code: 'VALIDATION', message: expect.stringContaining('no run command') });
    await expect(service.start('nope')).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
  });
});
