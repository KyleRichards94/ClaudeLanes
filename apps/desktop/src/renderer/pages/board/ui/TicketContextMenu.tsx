import { useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, type PressableInstance } from 'react-native';
import { color, radius, space } from '@agent-lanes/tokens';
import { Icon } from '@agent-lanes/ui';
import { useAgentTicket, type AgentTicketStore } from '@/entities/agent-ticket';
import { RemoveTicketModal } from '@/features/remove-ticket';
import { ChangeStateModal, MoveStageModal, TICKET_MENU, ViewDescriptionModal, ticketMenuItems } from '@/features/ticket-actions';
import { useConnections, useOpenWorktree, useReconnectSession, useTicketRecord, useWorkItem, type AdoOrgId } from '@/shared/api';
import { copyText } from '@/shared/lib';
import { toast } from '@/shared/model';
import { MenuPopover, type MenuAnchor } from '@/shared/ui';

function sameOrgUrl(a: string, b: string): boolean {
  const trim = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();
  return trim(a) === trim(b);
}

export interface TicketContextMenuProps {
  ticketId: string;
  store?: AgentTicketStore;
  /** Where the menu opens (the pointer, or the corner button); null while closed. */
  anchor: MenuAnchor | null;
  onClose(): void;
  testID?: string;
}

type Dialog = 'description' | 'ado-state' | 'move-stage' | 'remove' | null;

/**
 * The card's context menu (AL-270): right-click, the Menu key or the corner chevron. The page
 * composes the features behind each item: work item actions (features/ticket-actions), Resume
 * (the Reconnect path), Open worktree folder (AL-267), Copy branch, and Remove from board.
 */
export function TicketContextMenu({ ticketId, store, anchor, onClose, testID = `ticket-menu-${ticketId}` }: TicketContextMenuProps) {
  const ticket = useAgentTicket(ticketId, store);
  const record = useTicketRecord(ticketId).data ?? undefined;
  const ado = ticket?.ado ?? null;
  const connections = useConnections();
  const org = (ado ? connections.data?.find((row) => row.kind === 'ado' && sameOrgUrl(row.orgUrl, ado.orgUrl))?.id : undefined) as AdoOrgId | undefined;
  const workItem = useWorkItem(ado?.workItemId, org);
  const reconnect = useReconnectSession(ticketId);
  const openWorktree = useOpenWorktree(ticketId);
  const [dialog, setDialog] = useState<Dialog>(null);
  if (!ticket) return null;

  const item = workItem.data;
  const items = ticketMenuItems({
    ticket,
    workItem: workItem.isPending ? undefined : item ? { state: item.state ?? null, webUrl: item.webUrl, description: item.description ?? null } : null,
    resumable: Boolean(record?.sessionId),
  });
  const fail = (title: string) => (error: Error) => toast({ id: `ticket-menu:${ticketId}`, tone: 'error', title, body: error.message });

  const onSelect = (key: string) => {
    switch (key) {
      case TICKET_MENU.openAdo:
        if (item?.webUrl) void Linking.openURL(item.webUrl);
        return;
      case TICKET_MENU.description:
        setDialog('description');
        return;
      case TICKET_MENU.adoState:
        setDialog('ado-state');
        return;
      case TICKET_MENU.moveStage:
        setDialog('move-stage');
        return;
      case TICKET_MENU.resume:
        reconnect.mutate(undefined, { onError: fail("Couldn't resume the session") });
        return;
      case TICKET_MENU.openWorktree:
        openWorktree.mutate(undefined, { onError: fail("Couldn't open the worktree folder") });
        return;
      case TICKET_MENU.copyBranch:
        void copyText(ticket.branch).then((copied) =>
          copied
            ? toast({ id: `copy-branch:${ticketId}`, tone: 'success', title: 'Branch name copied', body: ticket.branch })
            : toast({ id: `copy-branch:${ticketId}`, tone: 'error', title: "Couldn't copy the branch name", body: 'The clipboard is not available here.' }),
        );
        return;
      case TICKET_MENU.remove:
        setDialog('remove');
        return;
      default:
        return;
    }
  };

  return (
    <>
      <MenuPopover label="Ticket actions" items={items} anchor={anchor} onSelect={onSelect} onClose={onClose} testID={testID} />
      {ado && item ? (
        <>
          <ViewDescriptionModal visible={dialog === 'description'} title={ticket.title} description={item.description ?? ''} onClose={() => setDialog(null)} />
          <ChangeStateModal visible={dialog === 'ado-state'} ado={ado} {...(org ? { org } : {})} workItem={{ type: item.type ?? null, state: item.state ?? null, title: ticket.title }} onClose={() => setDialog(null)} />
        </>
      ) : null}
      <MoveStageModal visible={dialog === 'move-stage'} ticketId={ticketId} title={ticket.title} stage={ticket.stage} onClose={() => setDialog(null)} />
      <RemoveTicketModal ticketId={ticketId} visible={dialog === 'remove'} onClose={() => setDialog(null)} />
    </>
  );
}

/** The card's corner chevron: opens the context menu under itself (AL-270). */
export function TicketMenuButton({ onOpen, testID }: { onOpen(anchor: MenuAnchor): void; testID?: string }) {
  const trigger = useRef<PressableInstance>(null);
  return (
    <Pressable
      ref={trigger}
      role="button"
      aria-haspopup="menu"
      aria-label="Ticket actions"
      onPress={() => trigger.current?.measureInWindow((x, y, _width, height) => onOpen({ x, y: y + height + space.xs }))}
      style={styles.button}
      testID={testID}
    >
      <Icon name="chevron-down" size={14} color={color.ink} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
});
