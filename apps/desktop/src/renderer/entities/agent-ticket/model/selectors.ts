import { STAGES, type Lane } from '@agent-lanes/contracts';
import type { AgentTicketsState } from './store';
import type { AgentTicket } from './types';

/**
 * Selectors over the agent ticket store. Each returns a value that stays the same (`Object.is`)
 * until what it describes changes: one ticket's object, one lane's id array, or a count. Use them
 * with `useStore` (or the hooks in `hooks.ts`) so a component re-renders only for its own slice.
 */

/** One ticket; undefined when the board has no ticket with that id. */
export function selectTicket(state: AgentTicketsState, ticketId: string): AgentTicket | undefined {
  return state.byId.get(ticketId);
}

/** A lane's ticket ids, oldest entry into the lane first. The same array until a card enters or leaves the lane. */
export function selectLaneTicketIds(state: AgentTicketsState, lane: Lane): readonly string[] {
  return state.byLane[lane];
}

export function ticketNeedsYou(ticket: AgentTicket): boolean {
  return ticket.needsYou.length > 0;
}

/** Cards in the lane that need the user; the lane's count badge turns amber when it is above 0 (AL-143). */
export function selectLaneNeedsYouCount(state: AgentTicketsState, lane: Lane): number {
  let count = 0;
  for (const id of state.byLane[lane]) {
    const ticket = state.byId.get(id);
    if (ticket && ticketNeedsYou(ticket)) count += 1;
  }
  return count;
}

/**
 * The lane's ticket ids that need the user, in lane order, for the board's "need you" filter
 * (AL-142). A new array on every call: read it through `useLaneNeedsYouTicketIds` (shallow-equal).
 */
export function selectLaneNeedsYouTicketIds(state: AgentTicketsState, lane: Lane): string[] {
  return state.byLane[lane].filter((id) => {
    const ticket = state.byId.get(id);
    return ticket ? ticketNeedsYou(ticket) : false;
  });
}

/** How many tickets the board holds, for the sub-header's "8 agent tickets" (AL-142). */
export function selectTicketTotal(state: AgentTicketsState): number {
  return state.byId.size;
}

/** Board-wide counts for the header pills (AL-142) and the live dock (AL-145). */
export const AGENT_TICKET_COUNTS = ['running', 'needs-you', 'queued', 'sub-agents-running', 'builds-running'] as const;
export type AgentTicketCount = (typeof AGENT_TICKET_COUNTS)[number];

const stageLanes = new Set<Lane>(STAGES);

/**
 * - `running`: cards in a stage lane (Planning to Create PR) that don't need the user ("4 running").
 * - `needs-you`: cards with at least one needs-you reason ("2 need you").
 * - `queued`: cards in the Queued lane ("1 queued").
 * - `sub-agents-running`: running sub-agents across tickets (dock "Sub-agents 7").
 * - `builds-running`: build or run jobs running now (dock "Builds 1").
 */
export function selectTicketCount(state: AgentTicketsState, count: AgentTicketCount): number {
  if (count === 'queued') return state.byLane.queued.length;
  let total = 0;
  for (const ticket of state.byId.values()) {
    switch (count) {
      case 'running':
        if (stageLanes.has(ticket.stage) && !ticketNeedsYou(ticket)) total += 1;
        break;
      case 'needs-you':
        if (ticketNeedsYou(ticket)) total += 1;
        break;
      case 'sub-agents-running':
        total += ticket.subAgents.running;
        break;
      case 'builds-running':
        if (ticket.build.job?.state === 'running') total += 1;
        break;
    }
  }
  return total;
}
