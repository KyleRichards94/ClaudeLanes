import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AgentSessionStatus, AssignAgentRequest } from '@agent-lanes/contracts';
import { invoke, sessionStatusQueryKey, ticketRecordQueryKey, unwrap } from '@/shared/api';

export type AssignAgentInput = Omit<AssignAgentRequest, 'ticketId'>;

/**
 * Assign new agent (AL-263): ends the ticket's session and starts another in the same worktree, with
 * a hand-over brief or the original job. The new session's status replaces the cached one at once;
 * the record (model, skills, past sessions) is read again.
 */
export function useAssignAgent(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AssignAgentInput) => unwrap(await invoke('agent:assign', { ticketId, ...input })),
    onSuccess: ({ status }) => {
      queryClient.setQueryData<AgentSessionStatus>(sessionStatusQueryKey(ticketId), status);
      void queryClient.invalidateQueries({ queryKey: ticketRecordQueryKey(ticketId) });
    },
  });
}
