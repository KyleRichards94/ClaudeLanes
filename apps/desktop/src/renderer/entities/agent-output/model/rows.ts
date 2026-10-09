import type { AgentOutputEvent, OutputToolKind, UserMessageSource } from '@agent-lanes/contracts';

/**
 * What the drill-in's Output tab draws (AL-175, artboard 3 Output): the lead agent's output events
 * folded into display rows.
 *
 * - `system`: an app line, "13:58 · Plan approved by Kyle · moved to Implementing".
 * - `tool`: one row per tool call (several for a Spawn row); a later `tool` with the same `rowId`
 *   replaces it and a `tool-result` replaces its stats and marks an error.
 * - `prose`: a finished block of assistant text.
 * - `streaming`: text still streaming in; drawn with a caret while it is the newest row.
 * - `failed`: a turn that ended in an error (`error_max_turns`, …). Successful turn ends draw nothing:
 *   usage and cost belong to the session pill (AL-113).
 *
 * Sub-agent output (`parentToolUseId` set) is left out: it belongs under its node in the sub-agents
 * tree (AL-107).
 */
export type OutputRow =
  | { readonly type: 'system'; readonly key: string; readonly at: number; readonly text: string }
  /** What the user sent (AL-251): a composer message, a `/skill`, the launch job or a hand-over brief. */
  | {
      readonly type: 'user';
      readonly key: string;
      readonly at: number;
      readonly text: string;
      readonly source: UserMessageSource;
      readonly priority: 'now' | 'next' | null;
      readonly messageId: string | null;
    }
  /** A turn that ended well (AL-251): "Turn ended · 1m 12s · $0.42"; `live` while it is the newest row ("waiting for you"). */
  | { readonly type: 'turn-end'; readonly key: string; readonly at: number; readonly durationMs: number; readonly costUsd: number; readonly live: boolean }
  | {
      readonly type: 'tool';
      readonly key: string;
      readonly tool: OutputToolKind;
      readonly label: string;
      readonly detail: string;
      readonly stats: string | null;
      readonly isError: boolean;
    }
  | { readonly type: 'prose'; readonly key: string; readonly text: string }
  | { readonly type: 'streaming'; readonly key: string; readonly text: string; readonly live: boolean }
  | { readonly type: 'failed'; readonly key: string; readonly text: string };

export type OutputRowType = OutputRow['type'];

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Folds a ticket's events (oldest first) into rows, oldest first. Linear in the number of events. */
export function outputRows(events: readonly AgentOutputEvent[]): OutputRow[] {
  const rows: Mutable<OutputRow>[] = [];
  const toolRows = new Map<string, number>();
  const streams = new Map<string, number>();
  let costSoFar = 0;

  for (const { seq, at, item } of events) {
    if (item.parentToolUseId !== null) continue;
    switch (item.kind) {
      case 'system':
        rows.push({ type: 'system', key: `s${seq}`, at, text: item.text });
        break;
      case 'tool': {
        const index = toolRows.get(item.rowId);
        const previous = index === undefined ? undefined : rows[index];
        const row = {
          type: 'tool' as const,
          key: `t${item.rowId}`,
          tool: item.tool,
          label: item.label,
          detail: item.detail,
          // A replacement without stats keeps what the result already said.
          stats: item.stats ?? (previous?.type === 'tool' ? previous.stats : null),
          isError: previous?.type === 'tool' ? previous.isError : false,
        };
        if (index === undefined) {
          toolRows.set(item.rowId, rows.length);
          rows.push(row);
        } else rows[index] = row;
        break;
      }
      case 'tool-result': {
        const index = toolRows.get(item.rowId);
        const row = index === undefined ? undefined : rows[index];
        if (index === undefined || row?.type !== 'tool') break;
        rows[index] = { ...row, stats: item.stats ?? row.stats, isError: row.isError || item.isError };
        break;
      }
      case 'text-delta': {
        const index = streams.get(item.streamId);
        const row = index === undefined ? undefined : rows[index];
        if (row?.type === 'streaming') rows[index!] = { ...row, text: row.text + item.text };
        else {
          streams.set(item.streamId, rows.length);
          rows.push({ type: 'streaming', key: `d${item.streamId}`, text: item.text, live: false });
        }
        break;
      }
      case 'text': {
        const index = streams.get(item.streamId);
        const row = { type: 'prose' as const, key: `p${item.streamId}`, text: item.text };
        // The finished text takes its streamed line's place.
        if (index !== undefined && rows[index]?.type === 'streaming') rows[index] = row;
        else rows.push(row);
        streams.delete(item.streamId);
        break;
      }
      case 'user':
        rows.push({ type: 'user', key: `u${seq}`, at, text: item.text, source: item.source, priority: item.priority, messageId: item.messageId });
        break;
      case 'result':
        if (item.isError) rows.push({ type: 'failed', key: `r${seq}`, text: `Turn ended early · ${item.subtype.replaceAll('_', ' ')}` });
        else {
          // The result's cost is the session's running total; the turn's own cost is the change since the last one.
          const costUsd = Math.max(0, item.costUsd - costSoFar);
          costSoFar = Math.max(costSoFar, item.costUsd);
          rows.push({ type: 'turn-end', key: `r${seq}`, at, durationMs: item.durationMs, costUsd, live: false });
        }
        break;
    }
  }

  // Only the newest row can still be streaming; an older unfinished stream (an interrupted turn) reads as prose.
  const last = rows.at(-1);
  if (last?.type === 'streaming') rows[rows.length - 1] = { ...last, live: true };
  // The newest turn end is the one the agent is waiting after.
  if (last?.type === 'turn-end') rows[rows.length - 1] = { ...last, live: true };
  return rows.filter((row) => row.type !== 'prose' || row.text.trim() !== '');
}

/** A piece of a prose line: plain, **bold** (artboard 3 bolds form names) or `code`. */
export interface ProseSpan {
  readonly text: string;
  readonly style: 'plain' | 'bold' | 'code';
}

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;

/** Splits assistant prose into plain, bold and inline-code spans (a small Markdown subset). */
export function proseSpans(text: string): ProseSpan[] {
  const spans: ProseSpan[] = [];
  for (const part of text.split(INLINE)) {
    if (part === '') continue;
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) spans.push({ text: part.slice(2, -2), style: 'bold' });
    else if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) spans.push({ text: part.slice(1, -1), style: 'code' });
    else spans.push({ text: part, style: 'plain' });
  }
  return spans;
}

/** "1m 12s", "48s", "2h 05m" for the turn-end line. */
export function formatTurnDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** "Turn ended · 1m 12s · $0.42", with " · waiting for you" while it is the newest row. */
export function turnEndLabel(row: Extract<OutputRow, { type: 'turn-end' }>): string {
  const cost = row.costUsd > 0 && row.costUsd < 0.01 ? '<$0.01' : `$${row.costUsd.toFixed(2)}`;
  return `Turn ended · ${formatTurnDuration(row.durationMs)} · ${cost}${row.live ? ' · waiting for you' : ''}`;
}

/** The caption over a user bubble: "You · 14:02", "Skill · 14:02", "Launched · 14:02", "Handed over · 14:02". */
export function userCaption(row: Pick<Extract<OutputRow, { type: 'user' }>, 'source' | 'at' | 'priority'>): string {
  const who = row.source === 'skill' ? 'Skill' : row.source === 'launch' ? 'Launched' : row.source === 'hand-over' ? 'Handed over' : 'You';
  const when = row.at > 0 ? ` · ${outputClock(row.at)}` : '';
  return `${who}${when}${row.priority === 'now' ? ' · steered now' : ''}`;
}

/** Local wall-clock time, "13:58". */
export function outputClock(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** A stats piece and how it reads: `+214` added, `−0` removed, `0 errors` clean, `2 errors` failing. */
export interface StatSpan {
  readonly text: string;
  readonly tone: 'added' | 'removed' | 'ok' | 'error' | 'plain';
}

/** Splits a tool row's stats ("+214 −0", "0 errors · 2 warnings", "1,842 lines") into tinted pieces. */
export function statSpans(stats: string): StatSpan[] {
  const spans: StatSpan[] = [];
  for (const piece of stats.split(/\s+·\s+|\s+(?=[+−-]\d)/)) {
    if (!piece) continue;
    if (/^\+\d/.test(piece)) spans.push({ text: piece, tone: 'added' });
    else if (/^[−-]\d/.test(piece)) spans.push({ text: piece, tone: 'removed' });
    else if (/^0 errors?$/.test(piece)) spans.push({ text: piece, tone: 'ok' });
    else if (/^[\d,]+ errors?$/.test(piece)) spans.push({ text: piece, tone: 'error' });
    else spans.push({ text: piece, tone: 'plain' });
  }
  return spans;
}
