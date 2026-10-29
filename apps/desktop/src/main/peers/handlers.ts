import { ok, type PEERS_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { Services } from '../services';

/** The peers domain's channels (E18): the network's status, never the team secret. */
export function createPeersHandlers({ peerNetwork, peerLanes }: Pick<Services, 'peerNetwork' | 'peerLanes'>): HandlersFor<(typeof PEERS_INVOKE_CHANNELS)[number]> {
  return {
    'peers:list': () => ok(peerNetwork.status()),
    'peers:rooms': () => ok(peerLanes.rooms()),
    'peers:log': ({ room, since }) => peerLanes.log(room, since),
    'peers:post': (request) => peerLanes.personPost(request),
    'peers:markSeen': ({ room, upTo }) => ok(peerLanes.markSeen(room, upTo)),
  };
}
