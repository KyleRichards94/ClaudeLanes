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
 * Sub-agent output (`parentToolUseId` set) nests under the Spawn row that started it (AL-261), as
 * its own tool rows and text.
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
  /** The context was compacted (AL-257): "Context compacted · auto · 160k → 40k tokens". */
  | { readonly type: 'compact'; readonly key: string; readonly at: number; readonly trigger: 'auto' | 'manual'; readonly preTokens: number; readonly postTokens: number | null }
  /** A turn that ended well (AL-251): "Turn ended · 1m 12s · $0.42"; `live` while it is the newest row ("waiting for you"). */
  | { readonly type: 'turn-end'; readonly key: string; readonly at: number; readonly durationMs: number; readonly costUsd: number; readonly live: boolean }
  | {
      readonly type: 'tool';
      readonly key: string;
      /** The SDK tool-use ids behind the row, so a waiting permission request finds its row (AL-260). */
      readonly toolUseIds: readonly string[];
      readonly tool: OutputToolKind;
      readonly label: string;
      readonly detail: string;
      readonly stats: string | null;
      readonly isError: boolean;
      /** The expanded row (AL-256): the call's full input, an Edit's before and after, and what the tool returned. */
      readonly input: string | null;
      readonly edit: { readonly before: string; readonly after: string } | null;
      readonly output: string | null;
      /** A Spawn row's sub-agents with their own rows (AL-261); empty for other tools. */
      readonly subagents: readonly SubagentLane[];
    }
  | { readonly type: 'prose'; readonly key: string; readonly text: string }
  /** The agent's reasoning (AL-262), collapsed to "Thinking…" while it streams and "Thought" after. */
  | { readonly type: 'thinking'; readonly key: string; readonly text: string; readonly live: boolean }
  | { readonly type: 'streaming'; readonly key: string; readonly text: string; readonly live: boolean }
  | { readonly type: 'failed'; readonly key: string; readonly text: string };

export type OutputRowType = OutputRow['type'];

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** A sub-agent's own output under its Spawn row (AL-261): its tool rows and text, nested. */
export interface SubagentLane {
  /** The Agent/Task tool use that spawned it. */
  readonly toolUseId: string;
  readonly name: string;
  readonly rows: readonly OutputRow[];
  /** Its newest row in one line ("Read README.md", "Found 4 forms"), for the collapsed Spawn row. */
  readonly latest: string | null;
}

/** One agent's rows while folding: the lead agent's, or a sub-agent's (keyed by the tool use that spawned it). */
interface Lane {
  rows: Mutable<OutputRow>[];
  toolRows: Map<string, number>;
  streams: Map<string, number>;
  costSoFar: number;
  /** Row keys are unique across the whole stream: a sub-agent's carry its tool use id. */
  prefix: string;
  /** Each Spawn row's sub-agent names, by row key. */
  spawnNames: Map<string, readonly string[]>;
}

function newLane(prefix: string): Lane {
  return { rows: [], toolRows: new Map(), streams: new Map(), costSoFar: 0, prefix, spawnNames: new Map() };
}

/**
 * Folds a ticket's events (oldest first) into rows, oldest first. Linear in the number of events.
 * Sub-agent events (`parentToolUseId` set) fold into their own lane, attached to the Spawn row that
 * started them (AL-261); a lane whose Spawn row never arrived is left out.
 */
export function outputRows(events: readonly AgentOutputEvent[]): OutputRow[] {
  const lead = newLane('');
  const lanes = new Map<string, Lane>();
  const laneFor = (parent: string | null): Lane => {
    if (parent === null) return lead;
    let lane = lanes.get(parent);
    if (!lane) {
      lane = newLane(`${parent}/`);
      lanes.set(parent, lane);
    }
    return lane;
  };
  for (const { seq, at, item } of events) fold(laneFor(item.parentToolUseId), seq, at, item);

  const attached = new Set<string>();
  const attach = (lane: Lane): OutputRow[] =>
    finishLane(lane).map((row) => {
      if (row.type !== 'tool' || row.tool !== 'spawn') return row;
      const names = lane.spawnNames.get(row.key) ?? [];
      const subagents = row.toolUseIds.map((toolUseId, index): SubagentLane => {
        const sub = lanes.get(toolUseId);
        // A lane attaches once: a sub-agent cannot sit under itself.
        const rows = sub && !attached.has(toolUseId) ? (attached.add(toolUseId), attach(sub)) : [];
        return { toolUseId, name: names[index] ?? 'agent', rows, latest: latestLine(rows) };
      });
      return { ...row, subagents };
    });
  return attach(lead);
}

function fold(lane: Lane, seq: number, at: number, item: AgentOutputEvent['item']): void {
  const { rows, toolRows, streams, prefix } = lane;
  switch (item.kind) {
    case 'system':
      rows.push({ type: 'system', key: `${prefix}s${seq}`, at, text: item.text });
      break;
    case 'tool': {
      const index = toolRows.get(item.rowId);
      const previous = index === undefined ? undefined : rows[index];
      const row = {
        type: 'tool' as const,
        key: `${prefix}t${item.rowId}`,
        toolUseIds: item.toolUseIds,
        tool: item.tool,
        label: item.label,
        detail: item.detail,
        // A replacement without stats keeps what the result already said.
        stats: item.stats ?? (previous?.type === 'tool' ? previous.stats : null),
        isError: previous?.type === 'tool' ? previous.isError : false,
        input: item.input ?? null,
        edit: item.edit ?? null,
        output: previous?.type === 'tool' ? previous.output : null,
        subagents: [],
      };
      if (item.names) lane.spawnNames.set(row.key, item.names);
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
      // A Spawn row collects each sub-agent's result; other rows have one.
      const output = row.output && row.tool === 'spawn' ? `${row.output}\n\n${item.output ?? ''}` : (item.output ?? row.output);
      rows[index] = { ...row, stats: item.stats ?? row.stats, isError: row.isError || item.isError, output: output?.trim() ? output : null };
      break;
    }
    case 'text-delta': {
      const index = streams.get(item.streamId);
      const row = index === undefined ? undefined : rows[index];
      if (row?.type === 'streaming') rows[index!] = { ...row, text: row.text + item.text };
      else {
        streams.set(item.streamId, rows.length);
        rows.push({ type: 'streaming', key: `${prefix}d${item.streamId}`, text: item.text, live: false });
      }
      break;
    }
    case 'text': {
      const index = streams.get(item.streamId);
      const row = { type: 'prose' as const, key: `${prefix}p${item.streamId}`, text: item.text };
      // The finished text takes its streamed line's place.
      if (index !== undefined && rows[index]?.type === 'streaming') rows[index] = row;
      else rows.push(row);
      streams.delete(item.streamId);
      break;
    }
    case 'thinking-delta': {
      const id = `think:${item.streamId}`;
      const index = streams.get(id);
      const row = index === undefined ? undefined : rows[index];
      if (row?.type === 'thinking') rows[index!] = { ...row, text: row.text + item.text };
      else {
        streams.set(id, rows.length);
        rows.push({ type: 'thinking', key: `${prefix}k${item.streamId}`, text: item.text, live: true });
      }
      break;
    }
    case 'thinking': {
      const id = `think:${item.streamId}`;
      const index = streams.get(id);
      const row = { type: 'thinking' as const, key: `${prefix}k${item.streamId}`, text: item.text, live: false };
      // The finished block takes its streamed row's place.
      if (index !== undefined && rows[index]?.type === 'thinking') rows[index] = row;
      else rows.push(row);
      streams.delete(id);
      break;
    }
    case 'user':
      rows.push({ type: 'user', key: `${prefix}u${seq}`, at, text: item.text, source: item.source, priority: item.priority, messageId: item.messageId });
      break;
    case 'compact':
      rows.push({ type: 'compact', key: `${prefix}c${seq}`, at, trigger: item.trigger, preTokens: item.preTokens, postTokens: item.postTokens });
      break;
    case 'result':
      if (item.isError) rows.push({ type: 'failed', key: `${prefix}r${seq}`, text: `Turn ended early · ${item.subtype.replaceAll('_', ' ')}` });
      else {
        // The result's cost is the session's running total; the turn's own cost is the change since the last one.
        const costUsd = Math.max(0, item.costUsd - lane.costSoFar);
        lane.costSoFar = Math.max(lane.costSoFar, item.costUsd);
        rows.push({ type: 'turn-end', key: `${prefix}r${seq}`, at, durationMs: item.durationMs, costUsd, live: false });
      }
      break;
  }
}

/** A lane's rows as drawn: only the newest row still streams or waits, and empty prose is dropped. */
function finishLane(lane: Lane): OutputRow[] {
  const rows = lane.rows;
  // Only the newest row can still be streaming; an older unfinished stream (an interrupted turn) reads as prose.
  const last = rows.at(-1);
  if (last?.type === 'streaming') rows[rows.length - 1] = { ...last, live: true };
  // The newest turn end is the one the agent is waiting after.
  if (last?.type === 'turn-end') rows[rows.length - 1] = { ...last, live: true };
  // Only the newest thinking can still be in progress (AL-262).
  for (let index = 0; index < rows.length - 1; index++) {
    const row = rows[index]!;
    if (row.type === 'thinking' && row.live) rows[index] = { ...row, live: false };
  }
  return rows.filter((row) => row.type !== 'prose' || row.text.trim() !== '');
}

/** The rows without the agent's thinking (AL-262), in every lane. */
export function withoutThinking(rows: readonly OutputRow[]): OutputRow[] {
  return rows.flatMap((row) => {
    if (row.type === 'thinking') return [];
    if (row.type === 'tool' && row.subagents.length > 0) return [{ ...row, subagents: row.subagents.map((sub) => ({ ...sub, rows: withoutThinking(sub.rows) })) }];
    return [row];
  });
}

/** The newest thing a sub-agent did, in one line. */
export function latestLine(rows: readonly OutputRow[]): string | null {
  for (let index = rows.length - 1; index >= 0; index--) {
    const row = rows[index]!;
    switch (row.type) {
      case 'tool':
        return `${row.label} ${row.detail}`.trim();
      case 'prose':
      case 'streaming':
      case 'failed':
      case 'system': {
        const line = row.text.split('\n').find((candidate) => candidate.trim() !== '')?.trim() ?? '';
        if (line) return line.length > 160 ? `${line.slice(0, 159)}…` : line;
        break;
      }
      default:
        break;
    }
  }
  return null;
}

/** The top-level row a tool use belongs to (AL-261): its own row, or the Spawn row whose sub-agent made it, with the row keys to open on the way. */
export function findToolUse(rows: readonly OutputRow[], toolUseId: string): { index: number; expandKeys: string[] } | null {
  const search = (lane: readonly OutputRow[]): { index: number; expandKeys: string[] } | null => {
    for (let index = 0; index < lane.length; index++) {
      const row = lane[index]!;
      if (row.type !== 'tool') continue;
      if (row.toolUseIds.includes(toolUseId)) return { index, expandKeys: [row.key] };
      for (const sub of row.subagents) {
        const nested = search(sub.rows);
        if (nested) return { index, expandKeys: [row.key, ...nested.expandKeys] };
      }
    }
    return null;
  };
  return search(rows);
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

/** "Context compacted · auto · 160k → 40k tokens" (AL-257). */
export function compactLabel(row: Pick<Extract<OutputRow, { type: 'compact' }>, 'trigger' | 'preTokens' | 'postTokens'>): string {
  const short = (tokens: number) => (tokens < 1_000 ? String(tokens) : tokens < 999_500 ? `${Math.round(tokens / 1_000)}k` : `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`);
  const change = row.postTokens === null ? `from ${short(row.preTokens)} tokens` : `${short(row.preTokens)} → ${short(row.postTokens)} tokens`;
  return `Context compacted · ${row.trigger === 'manual' ? 'by you' : 'auto'} · ${change}`;
}

/** The caption over a user bubble: "You · 14:02", "Skill · 14:02", "Launched · 14:02", "Handed over · 14:02". */
export function userCaption(row: Pick<Extract<OutputRow, { type: 'user' }>, 'source' | 'at' | 'priority'>): string {
  const who = row.source === 'skill' ? 'Skill' : row.source === 'launch' ? 'Launched' : row.source === 'hand-over' ? 'Handed over' : row.source === 'app-note' ? 'Agent Lanes' : 'You';
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

/**
 * A turn's rows (AL-279, grouped output): from the user's message (or the first tool or prose of a turn nothing
 * started) to the lead's `turn-end` or `failed` row. Numbered as `deriveTurns` (`entities/turn`) numbers the same
 * stream, so "Turn 3" is the same turn in the strip, the summary row and here. Rows between turns (app lines,
 * compaction notices) are one group with no `index`.
 */
export interface TurnGroup {
  /** 1-based turn number; null for the rows between turns. */
  readonly index: number | null;
  readonly rows: readonly OutputRow[];
  /** The turn has ended (its `turn-end` or `failed` row is in the group). The newest turn is live until it has. */
  readonly finished: boolean;
}

/** The key of a turn's header row, which is also the key its open state is kept under (`expanded.ts`). */
export const turnRowKey = (index: number): string => `turn:${index}`;

/**
 * Splits a stream's top-level rows into turns. A turn starts at a user message that is not the app's own, or at
 * the first tool, prose or thinking nothing started; further user messages inside it (queued or steered) stay in
 * it. It ends at the next `turn-end` or `failed` row. A turn with no end yet is the live one.
 */
export function groupTurns(rows: readonly OutputRow[]): TurnGroup[] {
  const groups: TurnGroup[] = [];
  // Held in an object: the helpers below assign it, which control-flow narrowing of a plain `let` would not see.
  const state: { open: OutputRow[] | null; loose: OutputRow[]; count: number } = { open: null, loose: [], count: 0 };

  const flushLoose = () => {
    if (state.loose.length > 0) groups.push({ index: null, rows: state.loose, finished: true });
    state.loose = [];
  };
  const turn = (): OutputRow[] => {
    if (!state.open) {
      // The app's own message that came just before the turn belongs to it.
      const carried: OutputRow[] = [];
      while (state.loose.at(-1)?.type === 'user') carried.unshift(state.loose.pop()!);
      flushLoose();
      state.open = carried;
    }
    return state.open;
  };
  const close = () => {
    if (!state.open) return;
    groups.push({ index: ++state.count, rows: state.open, finished: true });
    state.open = null;
  };

  for (const row of rows) {
    switch (row.type) {
      case 'user':
        // The app's own turns ("Continue where you left off.") start nothing; the next tool or prose does.
        if (row.source === 'app') (state.open ?? state.loose).push(row);
        else turn().push(row);
        break;
      case 'tool':
      case 'prose':
      case 'streaming':
      case 'thinking':
        turn().push(row);
        break;
      case 'system':
      case 'compact':
        (state.open ?? state.loose).push(row);
        break;
      case 'turn-end':
      case 'failed':
        turn().push(row);
        close();
        break;
    }
  }
  if (state.open) groups.push({ index: ++state.count, rows: state.open, finished: false });
  flushLoose();
  return groups;
}

/** A turn's header in the grouped stream: the collapsed summary row of a finished turn, or the live turn's caption. */
export interface TurnHeaderRow {
  readonly type: 'turn-header';
  readonly key: string;
  readonly index: number;
  /** The turn is still going: always open, with its rows under the header. */
  readonly live: boolean;
  /** The turn's rows are drawn under the header (always for the live turn). */
  readonly expanded: boolean;
  /** How many top-level rows the turn holds. */
  readonly rowCount: number;
}

/** What the grouped stream draws: the usual rows, and a header for each turn. */
export type StreamRow = OutputRow | TurnHeaderRow;

/**
 * The rows the grouped stream draws, top to bottom: for each turn a header, and under it the turn's rows when it
 * is open (`expanded` holds the keys of opened turns; the live turn is always open). Rows between turns stay as
 * they are. The result is one flat list, so the stream still windows it row by row.
 */
export function displayRows(groups: readonly TurnGroup[], expanded: ReadonlySet<string>): StreamRow[] {
  const out: StreamRow[] = [];
  for (const group of groups) {
    if (group.index === null) {
      out.push(...group.rows);
      continue;
    }
    const key = turnRowKey(group.index);
    const live = !group.finished;
    const open = live || expanded.has(key);
    out.push({ type: 'turn-header', key, index: group.index, live, expanded: open, rowCount: group.rows.length });
    if (open) out.push(...group.rows);
  }
  return out;
}
