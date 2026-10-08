import type { AgentSessionStatus } from '@agent-lanes/contracts';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { EventHandlers } from './event-handlers';
import { invoke, unwrap } from './ipc';

export const sessionStatusQueryKey = (ticketId: string) => ['agent', ticketId, 'status'] as const;

/**
 * The ticket's agent session status (AL-100): read once, then replaced by each `agent:status` event
 * (`sessionStatusEventHandlers`). `queued` while its repo is at the concurrency cap (AL-111), `paused`
 * after Pause (AL-105). Shared by the Queued notice (AL-111) and the composer (AL-176).
 */
export function useSessionStatus(ticketId: string) {
  return useQuery({
    queryKey: sessionStatusQueryKey(ticketId),
    queryFn: async (): Promise<AgentSessionStatus> => unwrap(await invoke('agent:getStatus', { ticketId })),
    staleTime: Infinity,
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
