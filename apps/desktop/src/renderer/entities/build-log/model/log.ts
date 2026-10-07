import type { BuildJobKind, BuildLogEvent, BuildLogLevel, BuildLogStream } from '@agent-lanes/contracts';

/** Most rows one ticket's log keeps; the oldest go first. Twice the 50,000 lines the tab must scroll (AL-135). */
export const BUILD_LOG_MAX_ROWS = 100_000;

/** A line of output, or the header row that starts each job's output ("Build · 14:02:05"). */
export interface BuildLogRow {
  /** Unique and increasing within a ticket's log, kept when older rows are dropped (a stable list key). */
  readonly id: number;
  readonly text: string;
  readonly level: BuildLogLevel | 'header';
  readonly stream: BuildLogStream | null;
  readonly jobId: string;
}

/** One ticket's build and run output, oldest first. A change replaces the object (and `rows`). */
export interface TicketBuildLog {
  readonly rows: readonly BuildLogRow[];
  /** Indexes into `rows` of the error lines, in order ("jump to next error"). */
  readonly errorRows: readonly number[];
  readonly warnings: number;
  /** Rows dropped off the top since the log started, so the tab can say the log was cut. */
  readonly dropped: number;
  readonly nextId: number;
}

export const EMPTY_BUILD_LOG: TicketBuildLog = { rows: [], errorRows: [], warnings: 0, dropped: 0, nextId: 1 };

const KIND_LABEL: Record<BuildJobKind, string> = { build: 'Build', run: 'Run' };

function clock(at: number): string {
  const time = new Date(at);
  return [time.getHours(), time.getMinutes(), time.getSeconds()].map((part) => String(part).padStart(2, '0')).join(':');
}

/** The header row text for a job's first batch: "Build · 14:02:05". */
export function jobHeader(kind: BuildJobKind, at: number): string {
  return `${KIND_LABEL[kind]} · ${clock(at)}`;
}

/**
 * Appends a frame's `build:log` batches for one ticket, in order, in one new log object. Each job's
 * output starts with a header row. Over BUILD_LOG_MAX_ROWS the oldest rows are dropped.
 */
export function appendBuildLog(log: TicketBuildLog, events: readonly BuildLogEvent[], maxRows = BUILD_LOG_MAX_ROWS): TicketBuildLog {
  if (events.length === 0) return log;
  const added: BuildLogRow[] = [];
  let nextId = log.nextId;
  let lastJob = log.rows.at(-1)?.jobId;
  let warnings = log.warnings;

  for (const event of events) {
    if (event.jobId !== lastJob) {
      added.push({ id: nextId++, text: jobHeader(event.kind, event.at), level: 'header', stream: null, jobId: event.jobId });
      lastJob = event.jobId;
    }
    for (const line of event.lines) {
      added.push({ id: nextId++, text: line.text, level: line.level, stream: line.stream, jobId: event.jobId });
    }
  }

  const all = log.rows.concat(added);
  const overflow = Math.max(all.length - maxRows, 0);

  if (overflow === 0) {
    // The common case: only the new rows are scanned.
    const errorRows = log.errorRows.slice();
    for (let index = log.rows.length; index < all.length; index++) {
      const level = all[index]!.level;
      if (level === 'error') errorRows.push(index);
      else if (level === 'warning') warnings += 1;
    }
    return { rows: all, errorRows, warnings, dropped: log.dropped, nextId };
  }

  // Rows were dropped: indexes shift, so the counts are taken again over what is kept.
  const rows = all.slice(overflow);
  const errorRows: number[] = [];
  warnings = 0;
  rows.forEach((row, index) => {
    if (row.level === 'error') errorRows.push(index);
    else if (row.level === 'warning') warnings += 1;
  });
  return { rows, errorRows, warnings, dropped: log.dropped + overflow, nextId };
}

/**
 * The error row "jump to next error" goes to: the first error after `fromRow`, wrapping round to the
 * first error. Null when the log has no errors.
 */
export function nextErrorRow(log: Pick<TicketBuildLog, 'errorRows'>, fromRow: number): number | null {
  const { errorRows } = log;
  if (errorRows.length === 0) return null;
  for (const row of errorRows) if (row > fromRow) return row;
  return errorRows[0]!;
}

/** The whole log as plain text for Copy, one line per row, header rows included. */
export function buildLogText(log: Pick<TicketBuildLog, 'rows'>): string {
  return log.rows.map((row) => (row.level === 'header' ? `── ${row.text} ──` : row.text)).join('\n');
}
