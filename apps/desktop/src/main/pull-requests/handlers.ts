import { ok, type PR_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

/** The `pr:*` channels: the Create PR stage of one ticket (AL-181). */
export function createPrHandlers({ pullRequests }: Pick<Services, 'pullRequests'>): HandlersFor<(typeof PR_INVOKE_CHANNELS)[number]> {
  return {
    'pr:draft': ({ ticketId }) => pullRequests.draft(ticketId),
    'pr:create': (request) => pullRequests.create(request),
    'pr:get': async ({ ticketId }) => {
      const state = await pullRequests.refresh(ticketId);
      return state.ok ? ok({ state: state.data }) : state;
    },
  };
}
