import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { PeerNetworkStatus } from '@agent-lanes/contracts';
import type { EventHandlers } from './event-handlers';
import { invoke, unwrap } from './ipc';

export const peerNetworkQueryKey = ['peers', 'network'] as const;

/** The listener and each listed peer's state (AL-289): the Peers tab's status dots. Kept current by `peers:status`. */
export function usePeerNetwork() {
  return useQuery({
    queryKey: peerNetworkQueryKey,
    queryFn: async () => unwrap(await invoke('peers:list')),
    staleTime: Infinity,
  });
}

/** `peers:status` replaces the cached network status. The app registers this with its event hub. */
export function peersEventHandlers(queryClient: QueryClient): EventHandlers {
  return {
    'peers:status': ({ listener, peers, refusedConnections }) => {
      queryClient.setQueryData<PeerNetworkStatus>(peerNetworkQueryKey, { listener, peers, refusedConnections });
    },
  };
}
