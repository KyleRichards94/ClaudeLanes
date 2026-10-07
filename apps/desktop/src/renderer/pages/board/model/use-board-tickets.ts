import { useEffect } from 'react';
import { agentTickets, type AgentTicketStore } from '@/entities/agent-ticket';
import { useTicketRecords } from '@/shared/api';

/**
 * Loads the ticket records into the agent ticket store whenever they are (re)read, so the lanes show
 * every ticket after a start. Tickets already on the board keep their live state (D376).
 */
export function useBoardTickets(store: AgentTicketStore = agentTickets) {
  const records = useTicketRecords();
  const data = records.data;
  useEffect(() => {
    if (data) store.load(data);
  }, [data, store]);
  return records;
}
