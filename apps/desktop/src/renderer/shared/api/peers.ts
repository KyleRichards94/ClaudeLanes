import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { InvokeRequest, PeerNetworkStatus, RoomLog, RoomMessage } from '@agent-lanes/contracts';
import type { EventHandlers } from './event-handlers';
import { invoke, unwrap } from './ipc';

export const peerNetworkQueryKey = ['peers', 'network'] as const;
export const peerRoomsQueryKey = ['peers', 'rooms'] as const;
export const roomLogQueryKey = (room: string) => ['peers', 'log', room] as const;

/** The listener and each listed peer's state (AL-289): the Peers tab's status dots. Kept current by `peers:status`. */
export function usePeerNetwork() {
  return useQuery({
    queryKey: peerNetworkQueryKey,
    queryFn: async () => unwrap(await invoke('peers:list')),
    staleTime: Infinity,
  });
}

/** Rooms this app's lanes are in, with members and unread counts, and peers' lanes elsewhere (AL-293). */
export function usePeerRooms() {
  return useQuery({
    queryKey: peerRoomsQueryKey,
    queryFn: async () => unwrap(await invoke('peers:rooms')),
    staleTime: Infinity,
  });
}

/** A room's log as this app has it, oldest first (AL-295); `peers:message` appends to it. */
export function useRoomLog(room: string | null) {
  return useQuery({
    queryKey: roomLogQueryKey(room ?? ''),
    queryFn: async () => unwrap(await invoke('peers:log', { room: room ?? '' })),
    enabled: room !== null,
    staleTime: Infinity,
  });
}

function addMessage(queryClient: QueryClient, message: RoomMessage, replacing?: string): void {
  if (!message.room) return;
  queryClient.setQueryData<RoomLog>(roomLogQueryKey(message.room), (log) => {
    if (!log) return log;
    const kept = log.messages.filter((item) => item.id !== message.id && item.id !== replacing);
    return { ...log, messages: [...kept, message] };
  });
}

/** A person's post from the Room tab (AL-295): shown at once, replaced by what main sent. */
export function usePostToRoom(person: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: InvokeRequest<'peers:post'>) => unwrap(await invoke('peers:post', request)),
    onMutate: (request) => {
      const pending: RoomMessage = {
        v: 1,
        id: crypto.randomUUID(),
        room: request.room,
        kind: request.kind,
        from: { user: person, host: 'this computer', instance: crypto.randomUUID(), person: true },
        lane: null,
        text: request.text,
        data: request.to ? { to: request.to } : {},
        sentAt: new Date().toISOString(),
        replay: false,
        own: true,
      };
      addMessage(queryClient, pending);
      return { pending };
    },
    onSuccess: (message, _request, context) => addMessage(queryClient, message, context?.pending.id),
    onError: (_error, request, context) => {
      queryClient.setQueryData<RoomLog>(roomLogQueryKey(request.room), (log) => log && { ...log, messages: log.messages.filter((item) => item.id !== context?.pending.id) });
    },
  });
}

/** Clears the Assist bubble up to a message once the room has been shown (AL-294). */
export function useMarkSeen() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: InvokeRequest<'peers:markSeen'>) => unwrap(await invoke('peers:markSeen', request)),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: peerRoomsQueryKey }),
  });
}

/** `peers:status`, `peers:presence` and `peers:message` keep the cached network, rooms and logs current. The app registers this with its event hub. */
export function peersEventHandlers(queryClient: QueryClient): EventHandlers {
  return {
    'peers:status': ({ listener, peers, refusedConnections }) => {
      queryClient.setQueryData<PeerNetworkStatus>(peerNetworkQueryKey, { listener, peers, refusedConnections });
    },
    'peers:presence': () => {
      void queryClient.invalidateQueries({ queryKey: peerRoomsQueryKey });
    },
    'peers:message': ({ message }) => {
      addMessage(queryClient, message);
      void queryClient.invalidateQueries({ queryKey: peerRoomsQueryKey });
    },
  };
}
