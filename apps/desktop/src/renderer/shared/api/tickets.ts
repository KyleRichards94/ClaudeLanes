import { useQuery } from '@tanstack/react-query';
import { invoke, unwrap } from './ipc';

export const ticketRecordQueryKey = (ticketId: string) => ['tickets', ticketId, 'record'] as const;

/**
 * One ticket's record from the main process (`tickets:get`, AL-170): the drill-in and the design tab
 * read it for fields the live store does not keep (session id, sub-branches, the design canvas).
 * Resolves `null` when no ticket has that id.
 */
export function useTicketRecord(ticketId: string) {
  return useQuery({
    queryKey: ticketRecordQueryKey(ticketId),
    queryFn: async () => unwrap(await invoke('tickets:get', { ticketId })).record,
  });
}
