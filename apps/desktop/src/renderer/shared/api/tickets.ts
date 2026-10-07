import { useQuery } from '@tanstack/react-query';
import { invoke, unwrap } from './ipc';

export const ticketsQueryKey = ['tickets'] as const;

/**
 * Every agent ticket record (AL-101) for the board to load into the agent ticket store (AL-143).
 * Records change in main as tickets launch and move; live state arrives as events, so this is read
 * when the board opens and refetched on window focus with the app's other server state.
 */
export function useTicketRecords() {
  return useQuery({
    queryKey: ticketsQueryKey,
    queryFn: async () => unwrap(await invoke('tickets:list')),
  });
}

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
