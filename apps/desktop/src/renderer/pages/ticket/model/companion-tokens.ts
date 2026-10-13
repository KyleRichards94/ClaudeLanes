import { useQueries } from '@tanstack/react-query';
import type { TicketRecord } from '@agent-lanes/contracts';
import { agentUsageQueryKey, invoke, unwrap } from '@/shared/api';

/**
 * Each second agent's tokens for its row on the Agents card (AL-266), from the same session usage the header pill
 * reads (`agent:getUsage`, kept current by `agent:usage` events). A second agent's session has no sub-agent tree to
 * take them from.
 */
export function useCompanionTokens(companions: readonly TicketRecord[]): Readonly<Record<string, number>> {
  const results = useQueries({
    queries: companions.map((record) => ({
      queryKey: agentUsageQueryKey(record.id),
      queryFn: async () => unwrap(await invoke('agent:getUsage', { ticketId: record.id })),
      staleTime: Infinity,
      refetchOnWindowFocus: false,
    })),
  });
  const tokens: Record<string, number> = {};
  companions.forEach((record, index) => {
    const used = results[index]?.data?.leadTokens;
    if (used !== undefined) tokens[record.id] = used;
  });
  return tokens;
}
