import { useState } from 'react';
import { ActionMenu } from '@/shared/ui';
import { RemoveTicketModal } from './RemoveTicketModal';

export interface RemoveTicketMenuProps {
  ticketId: string;
  testID?: string;
}

export const REMOVE_TICKET_KEY = 'remove-from-board';

/** The card's corner menu (Kyle, 2026-10-09): "Remove from board…" behind a small chevron, then the confirm modal. */
export function RemoveTicketMenu({ ticketId, testID = `ticket-menu-${ticketId}` }: RemoveTicketMenuProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ActionMenu
        label="Ticket actions"
        iconOnly
        items={[{ key: REMOVE_TICKET_KEY, label: 'Remove from board…', detail: 'Ends the agent and removes the worktree; the branch stays.', icon: 'archive', danger: true }]}
        onSelect={(key) => {
          if (key === REMOVE_TICKET_KEY) setOpen(true);
        }}
        testID={testID}
      />
      <RemoveTicketModal ticketId={ticketId} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
