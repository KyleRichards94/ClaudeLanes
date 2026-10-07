import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import {
  ACTIVE_RUN_STATES,
  err,
  ok,
  type BuildLogLine,
  type Result,
  type RunStatus,
  type RunTargetKind,
  type TicketLastRun,
} from '@agent-lanes/contracts';
import type { Emit } from '../../ipc/emit';
import type { TicketRecordStore } from '../../tickets';
import type { BuildService } from '../build-service';
import type { BuildCommands } from '../commands';
import { clampLine, createBatcher, DEFAULT_LOG_BATCH_MS } from '../log/lines';
import { createDiagnosticCollector, stripAnsi } from '../log/parse';
import { startCommand as defaultStartCommand, type CommandProcess, type StartCommand } from '../process/start-command';
import { findListeningUrl } from './listening-url';
import { createPortAllocator, isListening as defaultIsListening, type PortAllocator } from './ports';

/**
 * Run jobs (AL-133, design §10 Run): Run builds the ticket's worktree when its last build is stale,
 * then starts the repo's run command there as a child process. A web project gets a free port
 * (`ASPNETCORE_URLS` / `PORT`, and `--urls` on a detected `dotnet run`), and its listening URL is read
 * from its output (or found by probing the port), so the card shows "Running · localhost:5080" and two
 * tickets run the same app side by side. A desktop app opens its own window. Every change is a
 * `run:status` event; output goes to `build:log` with kind `run`.
 */
export interface RunService {
  /** Builds if stale, then starts the run; a ticket that is already running returns its status. */
  start(ticketId: string): Promise<Result<RunStatus>>;
  /** Every run started since the app opened, one (the newest) per ticket. */
  list(): RunStatus[];
  /** Opens the running web app's URL in the default browser; false when there is none. */
  openUrl(ticketId: string): Promise<Result<{ opened: boolean }>>;
}

export interface RunServiceOptions {
  tickets: Pick<TicketRecordStore, 'get' | 'update'>;
  buildCommands: Pick<BuildCommands, 'forRepo'>;
  builds: Pick<BuildService, 'build' | 'isStale'>;
  emit: Emit;
  /** Electron's `shell.openExternal` in the app. */
  openExternal: (url: string) => Promise<void>;
  startCommand?: StartCommand;
  ports?: PortAllocator;
  isListening?: (port: number) => Promise<boolean>;
  now?: () => number;
  createId?: () => string;
  /** How often a web app's port is probed while its URL has not been printed. */
  probeIntervalMs?: number;
  /** After this long without a URL the run counts as running anyway. */
  probeTimeoutMs?: number;
  logBatchMs?: number;
  folderExists?: (path: string) => Promise<boolean>;
  warn?: (message: string) => void;
}

interface Run {
  status: RunStatus;
  process: CommandProcess | null;
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Desktop and console apps need no port; web projects, scripts and unclassified overrides get one. */
function needsPort(kind: RunTargetKind | null): boolean {
  return kind !== 'desktop' && kind !== 'console';
}

export function createRunService(options: RunServiceOptions): RunService {
  const startCommand = options.startCommand ?? defaultStartCommand;
  const ports = options.ports ?? createPortAllocator();
  const isListening = options.isListening ?? defaultIsListening;
  const now = options.now ?? Date.now;
  const createId = options.createId ?? randomUUID;
  const probeIntervalMs = options.probeIntervalMs ?? 500;
  const probeTimeoutMs = options.probeTimeoutMs ?? 120_000;
  const folderExists = options.folderExists ?? isFolder;
  const warn = options.warn ?? ((message: string) => console.warn(`[run] ${message}`));

  const runs = new Map<string, Run>();

  function publish(run: Run): void {
    options.emit('run:status', { ...run.status, at: now() });
  }

  async function saveLastRun(run: Run): Promise<void> {
    const { ticketId, startedAt, stoppedAt, exitCode, url } = run.status;
    const lastRun: TicketLastRun = { startedAt, stoppedAt, exitCode, url };
    const saved = await options.tickets.update(ticketId, (current) => ({ ...current, lastRun }));
    if (!saved.ok) warn(`Could not save the last run of ticket ${ticketId}: ${saved.message}`);
  }

  function finish(run: Run, state: 'stopped' | 'failed', fields: { exitCode?: number | null; message?: string | null } = {}): void {
    if (run.status.port !== null) ports.release(run.status.port);
    run.status = { ...run.status, state, stoppedAt: now(), exitCode: fields.exitCode ?? null, message: fields.message ?? null };
    run.process = null;
    publish(run);
    void saveLastRun(run);
  }

  function setUrl(run: Run, url: string | null): void {
    if (run.status.state !== 'starting' && !(run.status.state === 'running' && run.status.url === null && url)) return;
    run.status = { ...run.status, state: 'running', url: url ?? run.status.url };
    publish(run);
    if (url) void saveLastRun(run);
  }

  /** Probes the port until the app listens, prints its URL, exits, or the timeout passes. */
  async function probe(run: Run, port: number): Promise<void> {
    const deadline = now() + probeTimeoutMs;
    while (run.status.state === 'starting') {
      if (await isListening(port)) {
        setUrl(run, `http://localhost:${port}/`);
        return;
      }
      if (now() >= deadline) {
        setUrl(run, null);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, probeIntervalMs));
    }
  }

  return {
    async start(ticketId) {
      const current = runs.get(ticketId);
      if (current && ACTIVE_RUN_STATES.includes(current.status.state)) return ok({ ...current.status });

      const record = await options.tickets.get(ticketId);
      if (!record) return err('VALIDATION', 'No ticket has that id.');
      const commands = await options.buildCommands.forRepo(record.repo, { dir: record.worktreePath });
      if (!commands.ok) return commands;
      const runCommand = commands.data.run;
      if (!runCommand) return err('VALIDATION', 'This repo has no run command. Set one in the repo settings.');
      if (!(await folderExists(record.worktreePath))) return err('VALIDATION', "The ticket's worktree folder is missing.");

      const detected = commands.data.detected;
      const runKind = detected?.runKind ?? null;
      const run: Run = {
        status: {
          ticketId,
          runId: createId(),
          state: 'building',
          runKind,
          port: null,
          url: null,
          startedAt: now(),
          stoppedAt: null,
          exitCode: null,
          message: null,
        },
        process: null,
      };
      runs.set(ticketId, run);
      publish(run);

      // Build first when the last build is stale (or never happened in this session).
      if (commands.data.build && (await options.builds.isStale(ticketId))) {
        const built = await options.builds.build(ticketId, { kind: 'run' });
        if (!built.ok) {
          finish(run, 'failed', { message: built.message });
          return built;
        }
        if (built.data.outcome === 'cancelled') {
          finish(run, 'stopped', { message: 'Build cancelled' });
          return ok({ ...run.status });
        }
      }

      let port: number | null = null;
      if (needsPort(runKind)) {
        try {
          port = await ports.allocate();
        } catch (cause) {
          finish(run, 'failed', { message: `No free port: ${cause instanceof Error ? cause.message : String(cause)}` });
          return err('INTERNAL', 'Could not find a free port for the app.');
        }
      }

      let command = runCommand.command;
      const env: Record<string, string> = {};
      if (port !== null) {
        const url = `http://localhost:${port}`;
        env['ASPNETCORE_URLS'] = url;
        env['PORT'] = String(port);
        // A launch profile's applicationUrl would win over the environment; command-line --urls wins over both.
        if (runCommand.origin === 'detected' && detected?.toolchain === 'dotnet' && !/\s--(\s|$)/.test(command)) {
          command = `${command} -- --urls=${url}`;
        }
      }

      run.status = { ...run.status, state: port === null ? 'running' : 'starting', port };
      const collector = createDiagnosticCollector();
      const batcher = createBatcher<BuildLogLine>({
        intervalMs: options.logBatchMs ?? DEFAULT_LOG_BATCH_MS,
        send: (lines) => options.emit('build:log', { ticketId, jobId: run.status.runId, kind: 'run', lines }),
      });
      const child = startCommand({
        command,
        cwd: record.worktreePath,
        env,
        onLine(stream, raw) {
          batcher.push({ text: clampLine(stripAnsi(raw)), stream, level: collector.read(raw).level });
          if (run.status.state === 'starting' || (run.status.state === 'running' && run.status.url === null && port !== null)) {
            const url = findListeningUrl(raw);
            if (url) setUrl(run, url);
          }
        },
      });
      run.process = child;
      publish(run);
      void saveLastRun(run);

      void child.exit.then((exit) => {
        batcher.flush();
        if (runs.get(ticketId) !== run) return;
        if (exit.error) {
          finish(run, 'failed', { message: `Could not start "${command}": ${exit.error.message}` });
        } else if (run.status.state === 'stopping' || exit.exitCode === 0) {
          finish(run, 'stopped', { exitCode: exit.exitCode });
        } else {
          finish(run, 'failed', { exitCode: exit.exitCode, message: exit.exitCode === null ? 'The app was killed' : `The app exited with code ${exit.exitCode}` });
        }
      });

      if (port !== null) void probe(run, port);
      return ok({ ...run.status });
    },

    list() {
      return [...runs.values()].map((run) => ({ ...run.status }));
    },

    async openUrl(ticketId) {
      const run = runs.get(ticketId);
      const url = run?.status.state === 'running' ? run.status.url : null;
      if (!url) return ok({ opened: false });
      try {
        await options.openExternal(url);
        return ok({ opened: true });
      } catch (cause) {
        warn(`Could not open ${url}: ${cause instanceof Error ? cause.message : String(cause)}`);
        return ok({ opened: false });
      }
    },
  };
}
