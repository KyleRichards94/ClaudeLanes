import type { QueryClient } from '@tanstack/react-query';
import type { EventHandlers } from './event-handlers';
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
