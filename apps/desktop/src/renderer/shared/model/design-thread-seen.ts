import { create } from 'zustand';
import type { DesignThreadMessage } from '@agent-lanes/contracts';

interface DesignThreadSeenState {
  /** Per ticket, the time of the newest design reply the user has seen on the Claude Design tab. */
  readonly byTicket: Readonly<Record<string, number>>;
}

/**
 * When the app started. The design thread's session runs inside the app, so no reply can arrive while
 * it is closed: replies older than this count as read until the user opens the tab.
 */
let baseline = Date.now();

/** In memory only (design §6 "local UI state"). */
const useDesignThreadSeen = create<DesignThreadSeenState>()(() => ({ byTicket: {} }));

/** The user is looking at the ticket's design thread: every reply up to `at` is read. */
export function markDesignThreadSeen(ticketId: string, at: number): void {
  useDesignThreadSeen.setState(({ byTicket }) => ((byTicket[ticketId] ?? baseline) >= at ? {} : { byTicket: { ...byTicket, [ticketId]: at } }));
}

/** Design replies newer than the last one the user saw (AL-200: the "Claude Design ↗" tab badge). */
export function unreadDesignReplies(messages: readonly Pick<DesignThreadMessage, 'role' | 'at'>[], seenAt: number): number {
  return messages.filter((message) => message.role === 'design' && message.at > seenAt).length;
}

/** The time up to which the ticket's design replies are read. */
export function useDesignThreadSeenAt(ticketId: string): number {
  return useDesignThreadSeen((state) => state.byTicket[ticketId] ?? baseline);
}

/** Forgets what was seen and restarts the baseline (tests). */
export function resetDesignThreadSeen(at = Date.now()): void {
  baseline = at;
  useDesignThreadSeen.setState({ byTicket: {} });
}
