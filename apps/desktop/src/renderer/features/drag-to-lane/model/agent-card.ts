import { LANES, type Lane, type TicketAdoRef } from '@agent-lanes/contracts';
import { LANE_LABELS, type DropAction } from '@/entities/agent-ticket';
import type { LaneDragCard } from './types';

/** What an agent board card needs to be dragged (AL-274). */
export interface AgentDragTicket {
  id: string;
  title: string;
  stage: Lane;
  ado: TicketAdoRef | null;
}

/** A PR review or comment-actioner card: no work item, named after its pull request. */
export function isPullRequestTicket(ticket: Pick<AgentDragTicket, 'id' | 'ado'>): boolean {
  return ticket.ado === null && /^pr-\d+/.test(ticket.id);
}

/** The lanes an agent card can be dropped on (AL-274): any but Queued and its own; a PR card only Done. */
export function agentDragLanes(ticket: AgentDragTicket): Lane[] {
  const candidates = isPullRequestTicket(ticket) ? (['done'] as Lane[]) : LANES.filter((lane) => lane !== 'queued');
  return candidates.filter((lane) => lane !== ticket.stage);
}

/** What dropping an agent card on a lane does: a stage move, nothing in Azure DevOps. */
export function agentMoveAction(lane: Lane): DropAction {
  return {
    lane,
    title: `Move to ${LANE_LABELS[lane]}`,
    label: `move to ${LANE_LABELS[lane]}`,
    detail: 'Moves the card; a running agent is told at its next turn.',
    changesAdo: false,
    adoChanges: [],
    worktree: 'main',
    planGate: null,
    skills: [],
    model: 'opus',
    effort: 'high',
  };
}

/** The drag data of an agent board card (AL-274); its drop is `agent:moveStage`. */
export function agentTicketDrag(ticket: AgentDragTicket): LaneDragCard {
  const lanes: Partial<Record<Lane, DropAction>> = {};
  for (const lane of agentDragLanes(ticket)) lanes[lane] = agentMoveAction(lane);
  return {
    key: `ticket:${ticket.id}`,
    label: ticket.ado ? `#${ticket.ado.workItemId}` : ticket.id,
    title: ticket.title,
    card: { kind: 'agent-ticket', ticketId: ticket.id },
    me: { id: 'me' },
    meName: null,
    source: { kind: 'agent-ticket', ticketId: ticket.id },
    lanes,
  };
}
