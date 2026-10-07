import { useTicketBoard } from '@/entities/agent-ticket';

/** Loads the reconciled board into the agent ticket store once the app starts (AL-090). Renders nothing. */
export function BoardSync() {
  useTicketBoard();
  return null;
}
