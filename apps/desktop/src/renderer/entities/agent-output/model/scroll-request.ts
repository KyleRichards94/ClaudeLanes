import { create } from 'zustand';

/**
 * "Show me this sub-agent's output" (AL-261): a sub-agent card asks the stream to scroll to the Spawn
 * row that started it. The request is kept by ticket until the stream has that row, then cleared, so
 * a card clicked while the Output tab is not mounted still lands on the row once it is.
 */
interface OutputScrollState {
  readonly byTicket: Readonly<Record<string, string>>;
}

const useOutputScrollRequests = create<OutputScrollState>()(() => ({ byTicket: {} }));

export function requestOutputScroll(ticketId: string, toolUseId: string): void {
  useOutputScrollRequests.setState(({ byTicket }) => ({ byTicket: { ...byTicket, [ticketId]: toolUseId } }));
}

/** Where a turn's request points: `turn:N`, the key of that turn's header row in the grouped stream. */
export const TURN_SCROLL_PREFIX = 'turn:';

/** "Show me turn N" (the turn strip): scrolls the grouped stream to that turn's header row. */
export function requestOutputTurnScroll(ticketId: string, turn: number): void {
  requestOutputScroll(ticketId, `${TURN_SCROLL_PREFIX}${turn}`);
}

export function clearOutputScroll(ticketId: string): void {
  useOutputScrollRequests.setState(({ byTicket }) => {
    if (!(ticketId in byTicket)) return {};
    const { [ticketId]: _cleared, ...rest } = byTicket;
    return { byTicket: rest };
  });
}

/** The tool use the ticket's stream should scroll to, or null. */
export function useOutputScrollRequest(ticketId: string): string | null {
  return useOutputScrollRequests((state) => state.byTicket[ticketId] ?? null);
}

/** Forgets every request (tests). */
export function resetOutputScrollRequests(): void {
  useOutputScrollRequests.setState({ byTicket: {} });
}
