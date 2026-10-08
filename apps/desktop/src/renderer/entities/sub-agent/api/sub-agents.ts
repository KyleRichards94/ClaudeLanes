import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { AgentSubagentEvent, AgentSubagents } from '@agent-lanes/contracts';
import { invoke, unwrap, type EventHandlers } from '@/shared/api';

export const subAgentsQueryKey = (ticketId: string) => ['agent', ticketId, 'subagents'] as const;

/**
 * The ticket's sub-agent tree, counts and the lead agent's tokens (AL-107, AL-177): read once with
 * `agent:getSubagents`, then kept current by each `agent:subagent` event (`subAgentEventHandlers`),
 * so a drill-in opened mid-run shows what already ran.
 */
export function useSubAgents(ticketId: string) {
  return useQuery({
    queryKey: subAgentsQueryKey(ticketId),
    queryFn: async (): Promise<AgentSubagents> => unwrap(await invoke('agent:getSubagents', { ticketId })),
    // Events carry the nodes; the lead agent's token count is read again every 30 s while the panel is open.
    refetchInterval: 30_000,
  });
}

/** The tree with one sub-agent's latest state: replaced in place, or added at the end when new. */
export function withSubAgentEvent(tree: AgentSubagents, event: AgentSubagentEvent): AgentSubagents {
  const index = tree.nodes.findIndex((node) => node.id === event.node.id);
  const nodes = index >= 0 ? tree.nodes.map((node, at) => (at === index ? event.node : node)) : [...tree.nodes, event.node];
  return { ...tree, nodes, counts: event.counts };
}

/**
 * `agent:subagent` → the ticket's cached tree. A ticket whose tree was never read is left alone; it is
 * read whole when its drill-in opens. The app registers these with its event hub.
 */
export function subAgentEventHandlers(queryClient: QueryClient): EventHandlers {
  return {
    'agent:subagent': (event) => {
      queryClient.setQueryData<AgentSubagents>(subAgentsQueryKey(event.ticketId), (tree) => (tree ? withSubAgentEvent(tree, event) : tree));
    },
  };
}
