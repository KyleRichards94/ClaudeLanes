import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { DesignThread } from '@agent-lanes/contracts';
import type { EventHandlers } from './event-handlers';
import { invoke, unwrap } from './ipc';

export const designThreadQueryKey = (ticketId: string) => ['design', ticketId, 'thread'] as const;

/**
 * The ticket's in-app design thread (`design:getThread`, AL-196). Main pushes every change as a
 * `design:thread` event (designThreadEventHandlers), so the cached thread never goes stale on its own;
 * it is read again when the tab mounts, which also picks up history saved before a restart.
 */
export function useDesignThread(ticketId: string, enabled = true) {
  return useQuery({
    queryKey: designThreadQueryKey(ticketId),
    queryFn: async () => unwrap(await invoke('design:getThread', { ticketId })),
    enabled,
    staleTime: Infinity,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** Sends a message to the design side; the reply arrives as a `design:thread` event. */
export function useSendDesignMessage(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (text: string) => unwrap(await invoke('design:sendThreadMessage', { ticketId, text })),
    onSuccess: (thread) => queryClient.setQueryData<DesignThread>(designThreadQueryKey(ticketId), thread),
  });
}

/** Approves or declines the canvas change waiting in the thread (D121). */
export function useAnswerDesignApproval(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ approvalId, approve }: { approvalId: string; approve: boolean }) =>
      unwrap(await invoke('design:answerThreadApproval', { ticketId, approvalId, approve })),
    onSuccess: (thread) => queryClient.setQueryData<DesignThread>(designThreadQueryKey(ticketId), thread),
  });
}

/** `design:thread` → that ticket's cached thread, so replies show on whichever tab is open. */
export function designThreadEventHandlers(queryClient: QueryClient): EventHandlers {
  return {
    'design:thread': (event) => {
      queryClient.setQueryData<DesignThread>(designThreadQueryKey(event.ticketId), event.thread);
    },
  };
}
