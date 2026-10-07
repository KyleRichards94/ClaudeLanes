import type { BuildDiagnostic, RunStatus } from './build.schemas';
import type { TicketLastBuild } from './tickets.schemas';

/**
 * What the card and the Worktree panel say about a ticket's last build (AL-132, artboards 3 and 6):
 * "Build failed · 3 errors" in the card's footer, the first error as its activity line
 * ("CS0246: JobFilterState not found") and "Last build 14:02 · succeeded" in the Worktree panel.
 * Pure, so the card (AL-160s), the panel (AL-173) and the tests share them.
 */

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "Build failed · 3 errors"; "Build failed" alone when the tool printed no error the parser knows. */
export function buildFailedLabel(errors: number): string {
  return errors > 0 ? `Build failed · ${plural(errors, 'error', 'errors')}` : 'Build failed';
}

/** C# "name not found" errors (CS0246, CS0103, CS0234 …), shortened the way artboard 6 shows them. */
const NOT_FOUND = [
  /^The type or namespace name '([^']+)' could not be found\b/,
  /^The name '([^']+)' does not exist in the current context\b/,
  /^The type or namespace name '([^']+)' does not exist in the namespace\b/,
  /^Cannot find name '([^']+)'/,
];

/** The compiler's message without the "(are you missing …?)" hint, or "X not found" for a missing name. */
export function shortDiagnosticMessage(message: string): string {
  for (const pattern of NOT_FOUND) {
    const match = pattern.exec(message);
    if (match?.[1]) return `${match[1]} not found`;
  }
  return message.replace(/\s*\((?:are you missing|did you mean)[^)]*\)\s*$/i, '').trim() || message;
}

/** "CS0246: JobFilterState not found": the card's activity line for a diagnostic. */
export function diagnosticActivity(diagnostic: Pick<BuildDiagnostic, 'code' | 'message'>): string {
  const message = shortDiagnosticMessage(diagnostic.message);
  return diagnostic.code ? `${diagnostic.code}: ${message}` : message;
}

export interface BuildCardState {
  /** The red footer band: "Build failed · 3 errors". */
  footer: string;
  /** The activity line: the first error, or null when there is none to show. */
  activity: string | null;
}

/** The card's "Build failed" state (artboard 6); null unless the last build failed. */
export function buildCardState(lastBuild: Pick<TicketLastBuild, 'outcome' | 'errors' | 'firstError'> | null): BuildCardState | null {
  if (lastBuild?.outcome !== 'failed') return null;
  return {
    footer: buildFailedLabel(lastBuild.errors),
    activity: lastBuild.firstError ? diagnosticActivity(lastBuild.firstError) : null,
  };
}

/** "14:02" in local time. */
export function formatClockTime(epochMs: number): string {
  const date = new Date(epochMs);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** "Last build 14:02 · succeeded", "Last build 14:02 · failed · 3 errors"; null before the first build. */
export function lastBuildLabel(
  lastBuild: Pick<TicketLastBuild, 'outcome' | 'errors' | 'finishedAt'> | null,
  formatTime: (epochMs: number) => string = formatClockTime,
): string | null {
  if (!lastBuild) return null;
  const outcome = lastBuild.outcome === 'failed' && lastBuild.errors > 0 ? `failed · ${plural(lastBuild.errors, 'error', 'errors')}` : lastBuild.outcome;
  return `Last build ${formatTime(lastBuild.finishedAt)} · ${outcome}`;
}

/** "localhost:5080" for `http://localhost:5080/`: what the card shows of a run's URL. */
export function runUrlHost(url: string): string {
  const withoutScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  return withoutScheme.split(/[/?#]/, 1)[0] || withoutScheme;
}

/**
 * The card's and Worktree panel's run line (AL-133, design §10): "Running · localhost:5080" for a web
 * project, "Running" for a desktop app, "Not running" before a run or after it stopped.
 */
export function runLabel(status: Pick<RunStatus, 'state' | 'url'> | null): string {
  switch (status?.state) {
    case 'building':
      return 'Building…';
    case 'starting':
      return 'Starting…';
    case 'running':
      return status.url ? `Running · ${runUrlHost(status.url)}` : 'Running';
    case 'stopping':
      return 'Stopping…';
    case 'failed':
      return 'Run failed';
    default:
      return 'Not running';
  }
}
