import { useFrameSelector } from '@/shared/lib';
import { ticketFeedOf, type TicketFeedEvent, type TicketFeedState } from './feed';
import { AGENT_TICKET_COUNTS, selectTicketCount, type AgentTicketCount } from './selectors';
import { agentTickets, type AgentTicketStore, type AgentTicketsState } from './store';

/**
 * Hooks for always-visible summaries (the live dock, AL-145) that must not re-render on every store
 * commit: each re-renders at most once per animation frame however busy the tickets are.
 */

const selectEvents = (state: TicketFeedState) => state.events;

/** The latest feed events across tickets, newest first. */
export function useLiveFeed(store: AgentTicketStore = agentTickets): readonly TicketFeedEvent[] {
  return useFrameSelector(ticketFeedOf(store), selectEvents);
}

// One stable selector per count, as useFrameSelector needs.
const countSelectors = Object.fromEntries(
  AGENT_TICKET_COUNTS.map((count) => [count, (state: AgentTicketsState) => selectTicketCount(state, count)]),
) as Record<AgentTicketCount, (state: AgentTicketsState) => number>;

/** A board-wide count ("Sub-agents 7", "Builds 1"), at most once per frame. */
export function useLiveTicketCount(count: AgentTicketCount, store: AgentTicketStore = agentTickets): number {
  return useFrameSelector(store, countSelectors[count]);
}
