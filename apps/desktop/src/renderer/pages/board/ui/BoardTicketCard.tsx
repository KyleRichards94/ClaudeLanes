import { useState } from 'react';
import { workItemStateColor, workItemTypeColor } from '@agent-lanes/contracts';
import { AgentTicketCardView, agentCardName, useAgentTicket, type AgentTicketStore } from '@/entities/agent-ticket';
import { LaneDragCard, agentTicketDrag, useDragToLaneAvailable } from '@/features/drag-to-lane';
import type { MenuAnchor } from '@/shared/ui';
import { PeerCardRows } from './PeerCardRows';
import { TicketContextMenu, TicketMenuButton } from './TicketContextMenu';
import { roomOfTicket } from '@/entities/peer';
import { useConnections, usePeerRooms, useWorkItem, useWorkItemColors } from '@/shared/api';

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
  // The context menu (AL-270): right-click, the Menu key, or the corner chevron.
  const [menuAt, setMenuAt] = useState<MenuAnchor | null>(null);
  // Inside the board's drag provider the card is a draggable (AL-274): the wrapper is the button and the press.
  const draggable = useDragToLaneAvailable();
  const room = roomOfTicket(usePeerRooms().data, ticketId);
  if (!ticket) return null;

  const type = workItem.data?.type ?? null;
  const state = workItem.data?.state ?? null;
  const card = (
    <AgentTicketCardView
      ticket={ticket}
      adoState={state}
      typeColor={workItemTypeColor(colors.data, type)}
      stateColor={workItemStateColor(colors.data, type, state)}
      cornerAction={<TicketMenuButton onOpen={setMenuAt} testID={`ticket-menu-${ticketId}`} />}
      peers={room ? <PeerCardRows room={room} ticketId={ticketId} workItemId={ado?.workItemId ?? null} /> : undefined}
      onContextMenu={setMenuAt}
      embedded={draggable}
      {...(onPress && !draggable ? { onPress } : {})}
      {...(testID ? { testID: draggable ? `${testID}-card` : testID } : {})}
    />
  );
  return (
    <>
      {draggable ? (
        <LaneDragCard drag={agentTicketDrag(ticket)} label={agentCardName(ticket)} {...(onPress ? { onClick: onPress } : {})} {...(testID ? { testID } : {})}>
          {card}
        </LaneDragCard>
      ) : (
        card
      )}
      <TicketContextMenu ticketId={ticketId} {...(store ? { store } : {})} anchor={menuAt} onClose={() => setMenuAt(null)} />
    </>
  );
}
