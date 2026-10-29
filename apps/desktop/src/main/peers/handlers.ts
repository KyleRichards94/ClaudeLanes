import { ok, type PEERS_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

/** The peers domain's channels (E18): the network's status, never the team secret. */
export function createPeersHandlers({ peerNetwork }: Pick<Services, 'peerNetwork'>): HandlersFor<(typeof PEERS_INVOKE_CHANNELS)[number]> {
  return {
    'peers:list': () => ok(peerNetwork.status()),
  };
}
