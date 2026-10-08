import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { EventHandlers } from './event-handlers';
import { invoke, unwrap } from './ipc';

/** `['agent', ticketId, 'usage']`: a session's tokens, cost and context window (AL-113). */
export function agentUsageQueryKey(ticketId: string) {
  return ['agent', ticketId, 'usage'] as const;
}

/**
 * The ticket session's usage for the session pill and the Lead agent card (artboard 3). Read once
 * with `agent:getUsage`, then kept current by `agent:usage` events (`agentUsageEventHandlers`), so it
 * never polls.
 */
export function useAgentUsage(ticketId: string) {
  return useQuery({
    queryKey: agentUsageQueryKey(ticketId),
    queryFn: async () => unwrap(await invoke('agent:getUsage', { ticketId })),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/** `agent:usage` → the ticket's usage query, replaced with the event's numbers. The app registers this with its event hub. */
export function agentUsageEventHandlers(queryClient: QueryClient): EventHandlers {
  return {
    'agent:usage': (event) => queryClient.setQueryData(agentUsageQueryKey(event.ticketId), event.usage),
  };
}
