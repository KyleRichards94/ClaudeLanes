import { stageOfLane, type AgentOutputEvent, type Lane, type TicketStageEntry } from '@agent-lanes/contracts';

/** The stage a turn ran in, as the turn strip names it (handoff data contracts). */
export type TurnStage = 'planning' | 'implementing' | 'codeReview' | 'qa' | 'createPr';

/** One turn: the user's message (or the app's) to the agent's `result` (AL-278). Derived from the output stream, never stored. */
export interface Turn {
  /** 1-based, in the order the turns started. */
  readonly index: number;
  /** The agent that ran most tool calls in the turn: the ticket id for the lead, a sub-agent's tool use id otherwise. */
  readonly leadAgentId: string;
  readonly startedAt: number;
  /** Null while the turn is live (no `result` yet). */
  readonly endedAt: number | null;
  /** The turn's own duration (the result's); a live turn's runs to its newest event. */
  readonly durationMs: number;
  readonly costUsd: number;
  /** The ticket's stage when the turn started. */
  readonly stage: TurnStage;
  /** The first sentence of the turn's final assistant text; empty until there is some. */
  readonly summary: string;
  /** Tool calls by the tag the output shows (Edit, Bash, Read, …). */
  readonly toolCounts: Readonly<Record<string, number>>;
}

const STAGE_OF_LANE: Readonly<Partial<Record<Lane, TurnStage>>> = {
  planning: 'planning',
  implementing: 'implementing',
  'code-review': 'codeReview',
  qa: 'qa',
  'create-pr': 'createPr',
  // Queued has not started; Done is past the last stage.
  queued: 'planning',
  done: 'createPr',
};

/** The turn stage of a board lane; single-step lanes map to the stage they do (`review-only` → Code review). */
export function turnStageOf(lane: Lane): TurnStage {
  return STAGE_OF_LANE[stageOfLane(lane)] ?? 'implementing';
}

/** The stage the ticket was in at `at`: its last entry at or before then, else its first. */
export function stageAt(history: readonly TicketStageEntry[], at: number): TurnStage {
  const entry = history.findLast((candidate) => candidate.at <= at) ?? history[0];
  return entry ? turnStageOf(entry.stage) : 'planning';
}

const SUMMARY_LIMIT = 140;

/** The first sentence of some assistant prose, without the markdown around it, clipped to one line. */
export function firstSentence(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.)]\s+)/, '').trim())
    .filter((line) => line !== '' && !/^```/.test(line));
  const plain = (lines[0] ?? '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
  const end = /[.!?](?=\s|$)/.exec(plain);
  const sentence = end ? plain.slice(0, end.index + 1) : plain;
  return sentence.length > SUMMARY_LIMIT ? `${sentence.slice(0, SUMMARY_LIMIT - 1).trimEnd()}…` : sentence;
}

interface Draft {
  startedAt: number;
  lastAt: number;
  rows: Set<string>;
  byAgent: Map<string, number>;
  toolCounts: Record<string, number>;
  lastText: string;
}

function draftAt(at: number): Draft {
  return { startedAt: at, lastAt: at, rows: new Set(), byAgent: new Map(), toolCounts: {}, lastText: '' };
}

function leadOf(draft: Draft, ticketId: string): string {
  let best = ticketId;
  let bestCount = draft.byAgent.get(ticketId) ?? 0;
  for (const [agentId, count] of draft.byAgent) {
    // Most tool calls wins; on a tie the lead keeps it, then the agent that started first.
    if (count > bestCount) {
      best = agentId;
      bestCount = count;
    }
  }
  return best;
}

/**
 * The turns in an output stream. A turn starts at a `user` item that is not the app's own (`app`), or at the
 * first tool or prose of a turn nothing started (history cut short, an app turn), and ends at the next `result`
 * of the lead agent. The turn with no `result` yet is the live one. Further user messages inside a turn (queued
 * or steered ones) stay in it. The stage is the ticket's when the turn started, from `stageHistory`.
 */
export function deriveTurns(events: readonly AgentOutputEvent[], stageHistory: readonly TicketStageEntry[]): Turn[] {
  const ticketId = events[0]?.ticketId ?? '';
  const turns: Turn[] = [];
  let open: Draft | null = null;
  // A result carries the session's running total (as the output rows' turn end reads it); a turn's own cost is the change since the last.
  let costSoFar = 0;

  const build = (draft: Draft, end: { at: number; durationMs: number; costUsd: number } | null): Turn => ({
    index: turns.length + 1,
    leadAgentId: leadOf(draft, ticketId),
    startedAt: draft.startedAt,
    endedAt: end?.at ?? null,
    durationMs: end ? (end.durationMs > 0 ? end.durationMs : Math.max(0, end.at - draft.startedAt)) : Math.max(0, draft.lastAt - draft.startedAt),
    costUsd: end?.costUsd ?? 0,
    stage: stageAt(stageHistory, draft.startedAt),
    summary: firstSentence(draft.lastText),
    toolCounts: draft.toolCounts,
  });

  for (const { at, item } of events) {
    const agentId = item.parentToolUseId ?? ticketId;
    switch (item.kind) {
      case 'user':
        // The app's own turns ("Continue where you left off.") start nothing; the next tool or prose does.
        if (item.source !== 'app' && !open) open = draftAt(at);
        break;
      case 'tool': {
        open ??= draftAt(at);
        open.lastAt = at;
        if (!open.rows.has(item.rowId)) {
          open.rows.add(item.rowId);
          open.byAgent.set(agentId, (open.byAgent.get(agentId) ?? 0) + 1);
          open.toolCounts[item.label] = (open.toolCounts[item.label] ?? 0) + 1;
        }
        break;
      }
      case 'text':
      case 'text-delta':
      case 'thinking':
      case 'thinking-delta': {
        open ??= draftAt(at);
        open.lastAt = at;
        if (item.kind === 'text' && item.parentToolUseId === null) open.lastText = item.text;
        break;
      }
      case 'tool-result':
      case 'compact':
        if (open) open.lastAt = at;
        break;
      case 'result': {
        // A sub-agent's own result does not end the lead's turn.
        if (item.parentToolUseId !== null) break;
        const draft: Draft = open ?? draftAt(Math.max(0, at - item.durationMs));
        const costUsd = Math.max(0, item.costUsd - costSoFar);
        costSoFar = Math.max(costSoFar, item.costUsd);
        turns.push(build(draft, { at, durationMs: item.durationMs, costUsd }));
        open = null;
        break;
      }
      case 'system':
        break;
    }
  }
  if (open) turns.push(build(open, null));
  return turns;
}

/** Tools by how often the turn used them, busiest first (the chip under a collapsed turn shows the top two). */
export function topToolCounts(counts: Readonly<Record<string, number>>, limit = 2): [label: string, count: number][] {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit);
}

/** "Edit 3 · Bash 4": the chip under a collapsed turn. Busiest tools first, at most `limit`. */
export function toolCountsLabel(counts: Readonly<Record<string, number>>, limit = 2): string {
  return topToolCounts(counts, limit)
    .map(([label, count]) => `${label} ${count}`)
    .join(' · ');
}

/** Total cost of the turns, for "7 turns · $2.06". */
export function turnsCost(turns: readonly Turn[]): number {
  return turns.reduce((sum, turn) => sum + turn.costUsd, 0);
}
