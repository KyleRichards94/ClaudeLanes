import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ArchiveTicketResult } from '@agent-lanes/contracts';
import { branchesQueryKey, invoke, unwrap } from '@/shared/api';
import { agentTickets, type AgentTicketStore } from '../model/store';

/** The archive list (AL-088). */
export const archivedTicketsQueryKey = ['tickets', 'archived'] as const;

export function useArchivedTickets() {
  return useQuery({
    queryKey: archivedTicketsQueryKey,
    queryFn: async () => unwrap(await invoke('tickets:archived')),
  });
}

/**
 * Archive, chosen by the user (AL-088): removes the ticket's worktrees and takes its card off the
 * board. Rejects with VALIDATION `unmerged-work` until the user confirms a second time
 * (`discardUnmerged`). A `partial` outcome keeps the card: some worktree could not be removed yet.
 */
export function useArchiveTicket(store: AgentTicketStore = agentTickets) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: { ticketId: string; discardUnmerged?: boolean; deleteMergedBranches?: boolean }) =>
      unwrap(await invoke('tickets:archive', { ...request, confirmed: true })),
    onSuccess: (result: ArchiveTicketResult, { ticketId }) => {
      if (result.status === 'archived') {
        store.remove(ticketId);
        queryClient.removeQueries({ queryKey: branchesQueryKey(ticketId) });
        void queryClient.invalidateQueries({ queryKey: archivedTicketsQueryKey });
      } else {
        void queryClient.invalidateQueries({ queryKey: branchesQueryKey(ticketId) });
      }
    },
  });
}
