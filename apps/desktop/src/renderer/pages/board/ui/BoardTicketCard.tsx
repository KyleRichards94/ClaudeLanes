import { workItemStateColor, workItemTypeColor } from '@agent-lanes/contracts';
import { AgentTicketCardView, useAgentTicket, type AgentTicketStore } from '@/entities/agent-ticket';
import { useConnections, useWorkItem, useWorkItemColors } from '@/shared/api';

export interface BoardTicketCardProps {
  ticketId: string;
  store?: AgentTicketStore;
  onPress?: () => void;
  testID?: string;
}

function sameOrgUrl(a: string, b: string): boolean {
  const trim = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();
  return trim(a) === trim(b);
}

/**
 * An agent lane's card with its work item's Azure DevOps state (R6) and ADO's type and state colours
 * (the bar by the id and the dot before the state). The work item and the colours are server state
 * (TanStack Query), read through the organisation the ticket's work item lives in; while they load,
 * or when they can't be read, the card shows no state and the token colours.
 */
export function BoardTicketCard({ ticketId, store, onPress, testID }: BoardTicketCardProps) {
  const ticket = useAgentTicket(ticketId, store);
  const ado = ticket?.ado ?? null;
  const connections = useConnections();
  const org = ado ? connections.data?.find((row) => row.kind === 'ado' && sameOrgUrl(row.orgUrl, ado.orgUrl))?.id : undefined;
  const workItem = useWorkItem(ado?.workItemId, org);
  const colors = useWorkItemColors({ ...(org ? { org } : {}), ...(ado ? { project: ado.project } : {}) }, { enabled: ado !== null });
  if (!ticket) return null;

  const type = workItem.data?.type ?? null;
  const state = workItem.data?.state ?? null;
  return (
    <AgentTicketCardView
      ticket={ticket}
      adoState={state}
      typeColor={workItemTypeColor(colors.data, type)}
      stateColor={workItemStateColor(colors.data, type, state)}
      {...(onPress ? { onPress } : {})}
      {...(testID ? { testID } : {})}
    />
  );
}
