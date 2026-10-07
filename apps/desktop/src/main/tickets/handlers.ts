import { ok, type TICKETS_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

/** Ticket record channels (AL-170). Launch (AL-165) and reconciliation (AL-090) add theirs to this factory. */
export function createTicketsHandlers({ tickets }: Pick<Services, 'tickets'>): HandlersFor<(typeof TICKETS_INVOKE_CHANNELS)[number]> {
  return {
    'tickets:get': async ({ ticketId }) => ok({ record: (await tickets.get(ticketId)) ?? null }),
  };
}
