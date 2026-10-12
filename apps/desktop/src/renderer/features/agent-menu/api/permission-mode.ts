import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AgentPermissionMode } from '@agent-lanes/contracts';
import { invoke, ticketRecordQueryKey, unwrap } from '@/shared/api';

/** The ticket's own permission mode (AL-264); null follows Settings again. */
export function useSetPermissionMode(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (mode: AgentPermissionMode | null) => unwrap(await invoke('agent:setPermissionMode', { ticketId, mode })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ticketRecordQueryKey(ticketId) }),
  });
}
