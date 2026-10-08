import type { AgentSessionStatus } from '@agent-lanes/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke, sessionStatusQueryKey, unwrap } from '@/shared/api';

// The status query moved to shared/api with AL-176 (the composer reads it too); re-exported here.
export { sessionStatusEventHandlers, sessionStatusQueryKey, useSessionStatus } from '@/shared/api';

/** "Start now" (AL-111): starts a queued ticket over its repo's cap. */
export function useStartNow(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await invoke('agent:startNow', { ticketId })),
    onSuccess: (status) => queryClient.setQueryData<AgentSessionStatus>(sessionStatusQueryKey(ticketId), status),
  });
}
