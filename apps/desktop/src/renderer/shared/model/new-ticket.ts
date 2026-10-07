import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';

/**
 * Whether the New agent ticket modal is open (artboard 2). The board header's "+ New agent ticket"
 * opens it; the app layer hosts the modal (features/create-ticket), so any page can open it without
 * importing the feature.
 */
const newTicketStore = createStore<{ open: boolean }>()(() => ({ open: false }));

export function openNewTicket(): void {
  newTicketStore.setState({ open: true });
}

export function closeNewTicket(): void {
  newTicketStore.setState({ open: false });
}

export function useNewTicketOpen(): boolean {
  return useStore(newTicketStore, (state) => state.open);
}
