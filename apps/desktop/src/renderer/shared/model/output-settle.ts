import type { AgentOutputEvent, OutputToolKind } from '@agent-lanes/contracts';
import { create } from 'zustand';

/**
 * What a ticket's live output says about the worktree and about the turn (AL-276, AL-277): two counters
 * that grow each time something settles, so a query can read again when its counter changes.
 * - `files`: a tool call that may have changed files finished (an Edit or Write that worked, any Bash), or a turn ended;
 * - `turns`: a turn ended (the reviewer's findings are written by then).
 * Only live events count. The transcript already on screen when a view opens is not news, so replay
 * after a restart never refetches. The output entity feeds this from `agent:output`; the entities that
 * query (diff-file, review-finding) read it, because entities cannot import each other.
 */
export interface OutputSettle {
  readonly files: number;
  readonly turns: number;
}

const NONE: OutputSettle = { files: 0, turns: 0 };

interface OutputSettleState {
  readonly byTicket: Readonly<Record<string, OutputSettle>>;
}

const useOutputSettleStore = create<OutputSettleState>()(() => ({ byTicket: {} }));

const FILE_TOOLS: ReadonlySet<OutputToolKind> = new Set(['edit', 'write', 'bash']);
/** Rows remembered per ticket, so a tool result can be matched with its tool row. */
const ROW_MEMORY = 400;
const rowsByTicket = new Map<string, Map<string, OutputToolKind>>();

function rememberRow(ticketId: string, rowId: string, tool: OutputToolKind) {
  const rows = rowsByTicket.get(ticketId) ?? new Map<string, OutputToolKind>();
  rowsByTicket.set(ticketId, rows);
  rows.set(rowId, tool);
  if (rows.size > ROW_MEMORY) {
    const oldest = rows.keys().next().value;
    if (oldest !== undefined) rows.delete(oldest);
  }
}

/** Counts what one frame's batch of `agent:output` events settled. */
export function noteOutputEvents(events: readonly AgentOutputEvent[]): void {
  const delta = new Map<string, { files: number; turns: number }>();
  const bump = (ticketId: string, key: 'files' | 'turns') => {
    const entry = delta.get(ticketId) ?? { files: 0, turns: 0 };
    entry[key] += 1;
    delta.set(ticketId, entry);
  };
  for (const { ticketId, item } of events) {
    if (item.kind === 'tool') {
      rememberRow(ticketId, item.rowId, item.tool);
    } else if (item.kind === 'tool-result') {
      const tool = rowsByTicket.get(ticketId)?.get(item.rowId);
      if (tool && FILE_TOOLS.has(tool) && !(item.isError && tool !== 'bash')) bump(ticketId, 'files');
    } else if (item.kind === 'result') {
      bump(ticketId, 'files');
      bump(ticketId, 'turns');
    }
  }
  if (delta.size === 0) return;
  useOutputSettleStore.setState(({ byTicket }) => {
    const next = { ...byTicket };
    for (const [ticketId, change] of delta) {
      const before = next[ticketId] ?? NONE;
      next[ticketId] = { files: before.files + change.files, turns: before.turns + change.turns };
    }
    return { byTicket: next };
  });
}

/** The ticket's settle counters; both stay 0 until live output settles something. */
export function useOutputSettle(ticketId: string): OutputSettle {
  return useOutputSettleStore((state) => state.byTicket[ticketId] ?? NONE);
}

/** Sum of the `turns` counters of several tickets (a lead and its second agents). */
export function useTurnsSettled(ticketIds: readonly string[]): number {
  return useOutputSettleStore((state) => ticketIds.reduce((sum, id) => sum + (state.byTicket[id]?.turns ?? 0), 0));
}

/** Forgets every counter (tests). */
export function resetOutputSettle(): void {
  useOutputSettleStore.setState({ byTicket: {} });
  rowsByTicket.clear();
}
