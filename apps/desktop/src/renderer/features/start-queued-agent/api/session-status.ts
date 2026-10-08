import type { AgentSessionStatus } from '@agent-lanes/contracts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { invoke, unwrap, type EventHandlers } from '@/shared/api';

export const sessionStatusQueryKey = (ticketId: string) => ['agent', ticketId, 'status'] as const;

/**
 * The ticket's agent session status (AL-100): read once, then replaced by each `agent:status` event
 * (`sessionStatusEventHandlers`). `queued` while its repo is at the concurrency cap (AL-111).
 */
export function useSessionStatus(ticketId: string) {
  return useQuery({
    queryKey: sessionStatusQueryKey(ticketId),
    queryFn: async (): Promise<AgentSessionStatus> => unwrap(await invoke('agent:getStatus', { ticketId })),
    staleTime: Infinity,
  });
}

/** "Start now" (AL-111): starts a queued ticket over its repo's cap. */
export function useStartNow(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await invoke('agent:startNow', { ticketId })),
    onSuccess: (status) => queryClient.setQueryData<AgentSessionStatus>(sessionStatusQueryKey(ticketId), status),
  });
}

/** `agent:status` → the ticket's session status. The app registers these with its event hub. */
export function sessionStatusEventHandlers(queryClient: QueryClient): EventHandlers {
  return {
    'agent:status': ({ ticketId, state, sessionId, message }) => {
      queryClient.setQueryData<AgentSessionStatus>(sessionStatusQueryKey(ticketId), { ticketId, state, sessionId, message });
    },
  };
}
