import { useMutation, useQueryClient } from '@tanstack/react-query';
import { branchesQueryKey, invoke, unwrap } from '@/shared/api';
import { agentTickets, type AgentTicketStore } from '../model/store';

/**
 * Merge sub-branches → ticket branch (AL-086, design §9 step 4, R9; the Merge panel's button, AL-174).
 * Every ready sub-branch is merged in creation order. On success the ticket's branch status
 * (`['branches', id]`) and its ADO work item (`['ado', 'workItem', id]`) are read again (design §6
 * Writes). Rejects with an IpcError: `MERGE_CONFLICT` (`details.files`, `details.branch`) stops at the
 * first conflict and leaves it in progress, which also refreshes branch status; `GIT_DIRTY` when the
 * ticket worktree has uncommitted changes.
 */
export function useMergeSubBranches(store: AgentTicketStore = agentTickets) {
  const queryClient = useQueryClient();
  const refresh = (ticketId: string, workItem: boolean) => {
    void queryClient.invalidateQueries({ queryKey: branchesQueryKey(ticketId) });
    const workItemId = store.getState().byId.get(ticketId)?.ado?.workItemId;
    if (workItem && workItemId !== undefined) void queryClient.invalidateQueries({ queryKey: ['ado', 'workItem', workItemId] });
  };
  return useMutation({
    mutationFn: async (request: { ticketId: string }) => unwrap(await invoke('git:mergeSubBranches', request)),
    onSuccess: (result) => refresh(result.ticketId, result.merged.length > 0),
    // A conflict may follow merges that did land, and leaves the worktree conflicted.
    onError: (_error, request) => refresh(request.ticketId, true),
  });
}

/** "Hand to lead agent": the conflicted files go to the ticket's lead agent as its next user turn. */
export function useHandConflictToLead() {
  return useMutation({
    mutationFn: async (request: { ticketId: string }) => unwrap(await invoke('git:handConflictToLead', request)),
  });
}

/** "I'll resolve it": opens the conflicted files in the user's editor. */
export function useOpenConflictFiles() {
  return useMutation({
    mutationFn: async (request: { ticketId: string }) => unwrap(await invoke('git:openConflictFiles', request)),
  });
}
