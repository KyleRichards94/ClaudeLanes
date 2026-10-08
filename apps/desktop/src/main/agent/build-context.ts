import type { BuildDiagnostic, BuildResult } from '@agent-lanes/contracts';
import type { Logger } from '../logging';
import type { SessionManager } from './session-manager';

/**
 * Build result as next-turn context (AL-112, design §10 "The agent sees the latest build result as
 * context on its next turn, so a failed build the user started is something it can fix"). When a
 * build of a ticket's worktree finishes, its result summary and first errors are pushed to the
 * ticket's live session as a user message with `shouldQuery: false` (Decision D11): it joins the
 * conversation and rides along with the agent's next turn, without starting one.
 */
export interface BuildContext {
  /** The build service's `onFinished`: tells the ticket's live session how the build went. */
  onBuildFinished(result: BuildResult): void;
}

export interface BuildContextOptions {
  sessions: Pick<SessionManager, 'send' | 'status'>;
  log?: Pick<Logger, 'info' | 'debug' | 'warn'>;
  /** How many errors the message lists. */
  maxErrors?: number;
}

/** Errors listed in the message; the rest are counted. */
export const BUILD_CONTEXT_MAX_ERRORS = 10;

const LIVE = new Set(['starting', 'running', 'idle', 'paused']);

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** One diagnostic as compilers print it: `file(line,col): CODE: message`. */
export function formatDiagnostic(item: BuildDiagnostic): string {
  const where = item.file ? `${item.file}${item.line ? `(${item.line}${item.column ? `,${item.column}` : ''})` : ''}: ` : '';
  return `${where}${item.code ? `${item.code}: ` : ''}${item.message}`;
}

/** The context message for a finished build; null for a cancelled one, which says nothing about the code. */
export function buildContextMessage(result: BuildResult, maxErrors = BUILD_CONTEXT_MAX_ERRORS): string | null {
  if (result.outcome === 'cancelled') return null;
  const what = result.kind === 'run' ? 'The build step of a Run the user started' : 'A build the user started';
  const counts = `${plural(result.errors, 'error', 'errors')} and ${plural(result.warnings, 'warning', 'warnings')}`;
  const lines = [
    `[Agent Lanes · build result] ${what} in this worktree has finished. This is context for your next turn; no reply is needed now.`,
    result.outcome === 'succeeded'
      ? `\`${result.command}\` succeeded with ${counts}.`
      : `\`${result.command}\` failed${result.exitCode !== null ? ` (exit code ${result.exitCode})` : ''} with ${counts}.`,
  ];
  const errors = result.diagnostics.filter((item) => item.severity === 'error');
  const shown = errors.slice(0, Math.max(0, maxErrors));
  if (shown.length > 0) {
    lines.push(shown.length < result.errors ? `First ${shown.length} of ${result.errors} errors:` : 'Errors:');
    for (const item of shown) lines.push(`- ${formatDiagnostic(item)}`);
  } else if (result.outcome === 'failed') {
    lines.push('No compiler errors were recognised in the output; the Build log tab has the full log.');
  }
  if (result.outcome === 'failed') lines.push('The user may expect you to fix these. Run the build again yourself to check the current state before you do.');
  return lines.join('\n');
}

export function createBuildContext(options: BuildContextOptions): BuildContext {
  const { sessions, log } = options;
  return {
    onBuildFinished(result) {
      const text = buildContextMessage(result, options.maxErrors);
      if (!text) return;
      if (!LIVE.has(sessions.status(result.ticketId).state)) {
        log?.debug(`No live session for ticket ${result.ticketId}; its build result is not sent`);
        return;
      }
      const sent = sessions.send(result.ticketId, { text, shouldQuery: false });
      if (sent.ok) log?.info(`Sent the ${result.outcome} build of ticket ${result.ticketId} to its session as context`);
      else log?.warn(`Could not send the build result of ticket ${result.ticketId} to its session: ${sent.message}`);
    },
  };
}
