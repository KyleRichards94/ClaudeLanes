import { NewTicketModal, useLaunchTicket } from '@/features/create-ticket';
import { closeNewTicket, useNewTicketOpen } from '@/shared/model';

/**
 * Hosts the New agent ticket modal for the whole app, like the ToastHost: pages open it with
 * `openNewTicket()` (the board header's "+ New agent ticket"). Launch (AL-165) creates the worktree
 * and record and starts the agent; the modal closes once it has, and the board highlights the card.
 */
export function NewTicketHost() {
  const open = useNewTicketOpen();
  const launch = useLaunchTicket();
  return (
    <NewTicketModal
      visible={open}
      onClose={closeNewTicket}
      onLaunch={async (request) => {
        await launch(request);
      }}
    />
  );
}
