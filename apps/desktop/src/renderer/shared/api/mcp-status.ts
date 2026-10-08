import type { McpStatusSummary } from '@agent-lanes/contracts';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { EventHandlers } from './event-handlers';
import { invoke, unwrap } from './ipc';

export const mcpStatusQueryKey = ['agent', 'mcpStatus'] as const;

/**
 * The MCP servers of the running agent sessions (AL-108), for the board header's "MCP online" pill.
 * Read once; after that `agent:mcpStatus` events replace it (`mcpStatusEventHandlers`).
 */
export function useMcpStatus() {
  return useQuery({
    queryKey: mcpStatusQueryKey,
    queryFn: async () => unwrap(await invoke('agent:getMcpStatus')),
    staleTime: Infinity,
  });
}

/** `agent:mcpStatus` → the cached summary. The app registers this with its event hub. */
export function mcpStatusEventHandlers(queryClient: QueryClient): EventHandlers {
  return {
    'agent:mcpStatus': ({ state, servers }) => {
      queryClient.setQueryData<McpStatusSummary>(mcpStatusQueryKey, { state, servers });
    },
  };
}
