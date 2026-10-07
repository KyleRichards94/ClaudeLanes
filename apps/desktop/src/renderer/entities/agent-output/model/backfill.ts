import { invoke } from '@/shared/api';
import { agentOutput, type AgentOutputStore } from './store';

/**
 * Starts showing a ticket's output: watch it first, so live events arriving while main answers are
 * kept, then merge the transcript main buffered (`agent:getTranscript`). Asking again for a ticket
 * already watched does nothing. Resolves false when main could not answer; live output still shows.
 */
export async function openTicketOutput(ticketId: string, store: AgentOutputStore = agentOutput): Promise<boolean> {
  if (!store.watch(ticketId)) return true;
  const result = await invoke('agent:getTranscript', { ticketId });
  if (!result.ok) return false;
  store.backfill(result.data);
  return true;
}
