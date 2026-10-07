import { ok, type TICKETS_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

/** Ticket records for the board (AL-143). Launch (AL-165) and reconciliation (AL-090) add their channels here. */
export function createTicketsHandlers({ tickets }: Pick<Services, 'tickets'>): HandlersFor<(typeof TICKETS_INVOKE_CHANNELS)[number]> {
  return {
    'tickets:list': async () => ok(await tickets.list()),
  };
}
