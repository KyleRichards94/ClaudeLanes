import type { Lane } from '@agent-lanes/contracts';
import { useStore } from 'zustand';
import { selectLaneNeedsYouCount, selectLaneTicketIds, selectTicket, selectTicketCount, type AgentTicketCount } from './selectors';
import { agentTickets, type AgentTicketStore } from './store';
import type { AgentTicket } from './types';

/**
 * Hooks over the app's agent ticket store. Each subscribes to one slice, so a card re-renders only
 * when its own ticket changes and a lane only when cards enter or leave it. `store` is for tests and
 * the component gallery; the app uses the default.
 */

/** One ticket, for its card or drill-in; undefined when the board has no ticket with that id. */
export function useAgentTicket(ticketId: string, store: AgentTicketStore = agentTickets): AgentTicket | undefined {
  return useStore(store, (state) => selectTicket(state, ticketId));
}

/** A lane's ticket ids, oldest entry first (AL-143). */
export function useLaneTicketIds(lane: Lane, store: AgentTicketStore = agentTickets): readonly string[] {
  return useStore(store, (state) => selectLaneTicketIds(state, lane));
}

/** How many cards in the lane need the user (the amber lane badge). */
export function useLaneNeedsYouCount(lane: Lane, store: AgentTicketStore = agentTickets): number {
  return useStore(store, (state) => selectLaneNeedsYouCount(state, lane));
}

/** A board-wide count: header pills (AL-142) and dock totals (AL-145). */
export function useAgentTicketCount(count: AgentTicketCount, store: AgentTicketStore = agentTickets): number {
  return useStore(store, (state) => selectTicketCount(state, count));
}
