import { ok, type AGENT_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

/** The `agent:*` invoke channels (AL-100 onwards), served by the session manager. */
export function createAgentHandlers({ sessions }: Pick<Services, 'sessions'>): HandlersFor<(typeof AGENT_INVOKE_CHANNELS)[number]> {
  return {
    'agent:getStatus': ({ ticketId }) => ok(sessions.status(ticketId)),
  };
}
