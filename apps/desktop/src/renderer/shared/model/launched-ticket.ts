import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/**
 * The ticket the user just launched (AL-165, design §9 step 1: "modal closes, board highlights the new
 * card"). The board's lane rings that card for a few seconds; a later launch moves the highlight.
 */
export const LAUNCH_HIGHLIGHT_MS = 6_000;

const launchedStore = createStore<{ ticketId: string | null }>()(() => ({ ticketId: null }));
let clearTimer: ReturnType<typeof setTimeout> | undefined;

/** Highlights the card of `ticketId` on the board for `LAUNCH_HIGHLIGHT_MS`. */
export function markLaunchedTicket(ticketId: string, durationMs: number = LAUNCH_HIGHLIGHT_MS): void {
  if (clearTimer !== undefined) clearTimeout(clearTimer);
  launchedStore.setState({ ticketId });
  clearTimer = setTimeout(() => {
    clearTimer = undefined;
    launchedStore.setState({ ticketId: null });
  }, durationMs);
}

/** Clears the highlight (tests). */
export function clearLaunchedTicket(): void {
  if (clearTimer !== undefined) clearTimeout(clearTimer);
  clearTimer = undefined;
  launchedStore.setState({ ticketId: null });
}

/** Whether `ticketId` is the card just launched. */
export function useIsLaunchedTicket(ticketId: string): boolean {
  return useStore(launchedStore, (state) => state.ticketId === ticketId);
}
