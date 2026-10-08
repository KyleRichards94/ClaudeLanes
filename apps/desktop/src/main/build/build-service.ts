import { stat } from 'node:fs/promises';
import {
  buildFailedLabel,
  err,
  ok,
  type BuildJobKind,
  type BuildLogLine,
  type BuildResult,
  type Result,
  type TicketRecord,
} from '@agent-lanes/contracts';
import type { Emit } from '../ipc/emit';
import type { TicketRecordStore } from '../tickets';
import type { BuildCommands } from './commands';
import type { WorktreeFingerprint } from './freshness';
import type { JobQueue } from './job-queue';
import { createBatcher, clampLine, DEFAULT_LOG_BATCH_MS } from './log/lines';
import { createDiagnosticCollector, stripAnsi } from './log/parse';
import { startCommand as defaultStartCommand, type StartCommand } from './process/start-command';

/**
 * Build jobs (AL-132, design §10): Build runs the repo's build command (AL-130) in the ticket's
 * worktree through the job queue (AL-131), streams its output as batched `build:log` events, reads
 * MSBuild, tsc and eslint diagnostics off it, and ends with `ok` or BUILD_FAILED with the counts.
 * The result is stored on the ticket ("Last build 14:02 · succeeded") and sent as `build:finished`,
 * so the card can show "Build failed · 3 errors" with the first error as its activity.
 */
export interface BuildService {
  /**
   * Builds the ticket's worktree and settles when the build ends. `kind: 'run'` marks the build step
   * of Run (AL-133) in the queue; aborting `signal` cancels the job (AL-134). VALIDATION when the ticket,
   * its worktree or a build command is missing.
   */
  build(ticketId: string, options?: { kind?: BuildJobKind; signal?: AbortSignal }): Promise<Result<BuildResult>>;
  /**
   * Whether Run must build first (AL-133): true unless the ticket's last build in this session
   * succeeded and its worktree still has the fingerprint it had when that build started.
   */
  isStale(ticketId: string): Promise<boolean>;
}

export interface BuildServiceOptions {
  tickets: Pick<TicketRecordStore, 'get' | 'update'>;
  buildCommands: Pick<BuildCommands, 'forRepo'>;
  queue: Pick<JobQueue, 'enqueue' | 'cancel'>;
  emit: Emit;
  startCommand?: StartCommand;
  now?: () => number;
  /** How long a log line waits to be sent with others. */
  logBatchMs?: number;
  /** Whether the worktree folder exists; tests pass a fake. */
  folderExists?: (path: string) => Promise<boolean>;
  warn?: (message: string) => void;
  /** Reads a worktree's state, so Run can skip a build that is still fresh (AL-133); without it every Run builds. */
  fingerprint?: WorktreeFingerprint;
  /** Every finished build, cancelled ones included: the agent gets it as next-turn context (AL-112). */
  onFinished?: (result: BuildResult) => void;
}

async function isFolder(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

interface ProcessRun {
  exitCode: number | null;
  startError: string | null;
}

export function createBuildService(options: BuildServiceOptions): BuildService {
  const startCommand = options.startCommand ?? defaultStartCommand;
  const now = options.now ?? Date.now;
  const folderExists = options.folderExists ?? isFolder;
  const fingerprint = options.fingerprint ?? (() => Promise.resolve(null));
  /** Ticket id → the worktree fingerprint taken as its last successful build started. */
  const fresh = new Map<string, string>();
  const warn = options.warn ?? ((message: string) => console.warn(`[build] ${message}`));

  async function saveLastBuild(record: TicketRecord, result: BuildResult): Promise<void> {
    const firstError = result.diagnostics.find((item) => item.severity === 'error') ?? null;
    const saved = await options.tickets.update(record.id, (current) => ({
      ...current,
      lastBuild: {
        outcome: result.outcome,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        errors: result.errors,
        warnings: result.warnings,
        firstError,
      },
    }));
    if (!saved.ok) warn(`Could not save the last build of ticket ${record.id}: ${saved.message}`);
  }

  return {
    async build(ticketId, { kind = 'build', signal } = {}) {
      const record = await options.tickets.get(ticketId);
      if (!record) return err('VALIDATION', 'No ticket has that id.');
      const commands = await options.buildCommands.forRepo(record.repo, { dir: record.worktreePath });
      if (!commands.ok) return commands;
      const command = commands.data.build?.command;
      if (!command) return err('VALIDATION', 'This repo has no build command. Set one in the repo settings.');
      if (!(await folderExists(record.worktreePath))) return err('VALIDATION', "The ticket's worktree folder is missing.");

      const collector = createDiagnosticCollector();
      let jobId = '';
      let startedAt: number | null = null;

      let before: string | null = null;
      const run = async (signal: AbortSignal): Promise<ProcessRun> => {
        startedAt = now();
        fresh.delete(ticketId);
        before = await fingerprint(record.worktreePath);
        const batcher = createBatcher<BuildLogLine>({
          intervalMs: options.logBatchMs ?? DEFAULT_LOG_BATCH_MS,
          send: (lines) => options.emit('build:log', { ticketId, jobId, kind, lines }),
        });
        const child = startCommand({
          command,
          cwd: record.worktreePath,
          onLine(stream, raw) {
            const { level } = collector.read(raw);
            batcher.push({ text: clampLine(stripAnsi(raw)), stream, level });
          },
        });
        const stop = (): void => void child.kill();
        signal.addEventListener('abort', stop, { once: true });
        if (signal.aborted) stop();
        const exit = await child.exit;
        signal.removeEventListener('abort', stop);
        const startError = exit.error ? `Could not start "${command}": ${exit.error.message}` : null;
        if (startError) batcher.push({ text: clampLine(startError), stream: 'stderr', level: 'error' });
        batcher.flush();
        return { exitCode: exit.exitCode, startError };
      };

      const job = options.queue.enqueue({ ticketId, worktreePath: record.worktreePath, kind, run });
      jobId = job.jobId;
      // Stop on a run that is still building (AL-134) cancels its build job, queued or running.
      const cancel = (): void => void options.queue.cancel(jobId);
      signal?.addEventListener('abort', cancel, { once: true });
      if (signal?.aborted) cancel();
      const outcome = await job.outcome;
      signal?.removeEventListener('abort', cancel);
      const finishedAt = now();

      const exitCode = outcome.status === 'finished' ? outcome.value.exitCode : null;
      const { errors, warnings } = collector.counts();
      const result: BuildResult = {
        jobId,
        ticketId,
        kind,
        outcome: outcome.status === 'cancelled' ? 'cancelled' : exitCode === 0 ? 'succeeded' : 'failed',
        command,
        exitCode,
        errors,
        warnings,
        diagnostics: collector.diagnostics(),
        startedAt: startedAt ?? finishedAt,
        finishedAt,
      };
      if (outcome.status === 'error') warn(`Build job ${jobId} of ticket ${ticketId} threw: ${String(outcome.error)}`);

      if (result.outcome === 'succeeded' && before !== null) fresh.set(ticketId, before);
      await saveLastBuild(record, result);
      options.emit('build:finished', { ...result, at: finishedAt });
      try {
        options.onFinished?.(result);
      } catch (error) {
        warn(`Could not hand the build of ticket ${ticketId} on: ${String(error)}`);
      }

      return result.outcome === 'failed' ? err('BUILD_FAILED', buildFailedLabel(result.errors), result) : ok(result);
    },

    async isStale(ticketId) {
      const builtAt = fresh.get(ticketId);
      const record = await options.tickets.get(ticketId);
      if (!builtAt || !record || record.lastBuild?.outcome !== 'succeeded') return true;
      return (await fingerprint(record.worktreePath)) !== builtAt;
    },
  };
}
