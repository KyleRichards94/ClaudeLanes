import { NewTicketModal, type NewTicketRequest } from '@/features/create-ticket';
import { closeNewTicket, toast, useNewTicketOpen } from '@/shared/model';

/**
 * Hosts the New agent ticket modal for the whole app, like the ToastHost: pages open it with
 * `openNewTicket()` (the board header's "+ New agent ticket").
 */
export function NewTicketHost() {
  const open = useNewTicketOpen();
  return <NewTicketModal visible={open} onClose={closeNewTicket} onLaunch={launchNotReady} />;
}

/** Launch (worktree, record, session) is AL-165; until it lands the request is acknowledged only. */
function launchNotReady(request: NewTicketRequest): void {
  toast({
    id: 'new-ticket-launch',
    tone: 'info',
    title: request.workItem ? `Agent ticket for #${request.workItem.id} is ready` : 'Agent ticket is ready',
    body: 'Launching agents comes in a later build; nothing was started.',
  });
}
