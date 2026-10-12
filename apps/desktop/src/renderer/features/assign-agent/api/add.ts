import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AddAgentRequest, AgentSessionStatus } from '@agent-lanes/contracts';
import { branchesQueryKey, invoke, sessionStatusQueryKey, ticketRecordQueryKey, ticketsQueryKey, unwrap } from '@/shared/api';

export type AddAgentInput = Omit<AddAgentRequest, 'ticketId'>;

/**
 * Add agent (AL-266): a second session on the ticket as a companion record. The records are read
 * again so the drill-in's switcher lists it; a helper's sub-branch lands on the lead's record and in
 * its branch status.
 */
export function useAddAgent(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AddAgentInput) => unwrap(await invoke('agent:addAgent', { ticketId, ...input })),
    onSuccess: ({ companionId, status }) => {
      queryClient.setQueryData<AgentSessionStatus>(sessionStatusQueryKey(companionId), status);
      void queryClient.invalidateQueries({ queryKey: ticketsQueryKey });
      void queryClient.invalidateQueries({ queryKey: ticketRecordQueryKey(ticketId) });
      // A helper's sub-branch shows in Sub-branches, which reads the branch status (AL-085).
      void queryClient.invalidateQueries({ queryKey: branchesQueryKey(ticketId) });
    },
  });
}
