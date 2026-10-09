import { create } from 'zustand';

/** Most messages kept per ticket for the up-arrow recall (AL-259). */
export const COMPOSER_HISTORY_LIMIT = 50;

interface HistoryState {
  readonly byTicket: Readonly<Record<string, readonly string[]>>;
}

/** In memory only, like the other local UI state (design §6): what was sent, newest last. */
const useHistory = create<HistoryState>()(() => ({ byTicket: {} }));

export function pushHistory(ticketId: string, text: string): void {
  const message = text.trim();
  if (!message) return;
  useHistory.setState(({ byTicket }) => {
    const previous = (byTicket[ticketId] ?? []).filter((entry) => entry !== message);
    return { byTicket: { ...byTicket, [ticketId]: [...previous, message].slice(-COMPOSER_HISTORY_LIMIT) } };
  });
}

export function useComposerHistory(ticketId: string): readonly string[] {
  return useHistory((state) => state.byTicket[ticketId] ?? EMPTY);
}

/** The ticket's history outside React (tests). */
export function getComposerHistory(ticketId: string): readonly string[] {
  return useHistory.getState().byTicket[ticketId] ?? EMPTY;
}

const EMPTY: readonly string[] = [];

/** Forgets every ticket's history (tests). */
export function resetComposerHistory(): void {
  useHistory.setState({ byTicket: {} });
}

/**
 * The next message to recall: up goes back from `index` (null = not recalling), down comes forward;
 * past the newest, the box goes back to the draft (`index` null).
 */
export function recall(history: readonly string[], index: number | null, direction: 'up' | 'down'): number | null {
  if (history.length === 0) return null;
  if (direction === 'up') return index === null ? history.length - 1 : Math.max(0, index - 1);
  if (index === null) return null;
  return index + 1 >= history.length ? null : index + 1;
}
