import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ShipDesignSpecRequest } from '@agent-lanes/contracts';
import type { EventHandlers } from './event-handlers';
import { invoke, unwrap } from './ipc';
import { ticketRecordQueryKey } from './tickets';

/**
 * `design:spec` (AL-197, AL-198): a spec was shipped, delivered, fetched or acknowledged. The spec list
 * lives on the ticket record, so the record is read again: "Attached to this ticket" shows
 * "Used · 14:01" and "Agent is watching this canvas" comes and goes live.
 */
export function createDesignSpecEventHandlers(queryClient: QueryClient): EventHandlers {
  return {
    'design:spec': (event) => void queryClient.invalidateQueries({ queryKey: ticketRecordQueryKey(event.ticketId) }),
  };
}

/**
 * Approve & ship the picked artboards to the ticket's agent as DesignSpec vN (`design:shipSpec`,
 * AL-197). Works in every stage; the ticket record is read again so "Attached to this ticket" lists
 * the new version.
 */
export function useShipDesignSpec() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: ShipDesignSpecRequest) => unwrap(await invoke('design:shipSpec', request)),
    onSuccess: (_result, request) => void queryClient.invalidateQueries({ queryKey: ticketRecordQueryKey(request.ticketId) }),
  });
}
