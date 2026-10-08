import type { AgentOutputEvent, OutputToolKind } from '@agent-lanes/contracts';

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
      case 'result':
        if (item.isError) rows.push({ type: 'failed', key: `r${seq}`, text: `Turn ended early · ${item.subtype.replaceAll('_', ' ')}` });
        break;
    }
  }

  // Only the newest row can still be streaming; an older unfinished stream (an interrupted turn) reads as prose.
  const last = rows.at(-1);
  if (last?.type === 'streaming') rows[rows.length - 1] = { ...last, live: true };
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
