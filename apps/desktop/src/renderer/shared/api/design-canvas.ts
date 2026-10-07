import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { TicketDesign, TicketRecord } from '@agent-lanes/contracts';
import { invoke, unwrap } from './ipc';
import { ticketRecordQueryKey } from './tickets';

function storeDesign(queryClient: QueryClient, ticketId: string, design: TicketDesign): void {
  queryClient.setQueryData<TicketRecord | null>(ticketRecordQueryKey(ticketId), (record) => (record ? { ...record, design } : record));
}

/**
 * Links the ticket to the Claude Design canvas a pasted link names (AL-193). Rejects with an
 * `IpcError` (`VALIDATION`, with a message for the user) when the link is not a canvas link.
 */
export function useLinkCanvas(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (url: string) => unwrap(await invoke('design:linkCanvas', { ticketId, url })),
    onSuccess: (design) => storeDesign(queryClient, ticketId, design),
  });
}

/** Unlinks the ticket's canvas; main closes its view (AL-193). */
export function useUnlinkCanvas(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await invoke('design:unlinkCanvas', { ticketId })),
    onSuccess: (design) => storeDesign(queryClient, ticketId, design),
  });
}
