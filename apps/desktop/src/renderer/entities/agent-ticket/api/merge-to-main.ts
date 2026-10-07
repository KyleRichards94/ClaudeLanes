import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MergeToMainResult } from '@agent-lanes/contracts';
import { branchesQueryKey, invoke, unwrap } from '@/shared/api';
import { agentTickets, type AgentTicketStore } from '../model/store';

/** Under `['branches', ticketId]`, so anything that invalidates the ticket's branch status refreshes it too. */
export function mergeToMainPreviewQueryKey(ticketId: string) {
  return [...branchesQueryKey(ticketId), 'merge-to-main'] as const;
}

/** `15:20`: local 24-hour time, as on the cards (artboard 6). */
function clockTime(at: number): string {
  const date = new Date(at);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** The Done card's activity row after Merge worktree → main: "Merged into main · 15:20" (artboard 6). */
export function mergedActivityText(target: string, at: number): string {
  return `Merged into ${target} · ${clockTime(at)}`;
}

/** What the Merge worktree → main confirm modal names and warns about (AL-087, AL-174). */
export function useMergeToMainPreview(ticketId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: mergeToMainPreviewQueryKey(ticketId),
    queryFn: async () => unwrap(await invoke('git:mergeToMainPreview', { ticketId })),
    enabled: options.enabled,
  });
}

/**
 * Merge worktree → main, after the user confirmed in the modal (AL-087). On success the card moves to
 * Done with "Merged into main · 15:20", and the ticket's branch status and ADO work item are read
 * again (design §6 Writes). Rejects with an IpcError carrying `GIT_DIRTY`, `MERGE_CONFLICT` or
 * `VALIDATION` (`qa-not-passed`: confirm again with `acceptQaWarning`).
 */
export function useMergeToMain(store: AgentTicketStore = agentTickets) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: { ticketId: string; acceptQaWarning?: boolean }) =>
      unwrap(await invoke('git:mergeToMain', { ...request, confirmed: true })),
    onSuccess: (result: MergeToMainResult) => {
      const { record } = result;
      store.upsert(record);
      store.setActivity(record.id, { text: mergedActivityText(result.target, result.mergedAt), progress: 1 }, result.mergedAt);
      void queryClient.invalidateQueries({ queryKey: branchesQueryKey(record.id) });
      if (record.ado) void queryClient.invalidateQueries({ queryKey: ['ado', 'workItem', record.ado.workItemId] });
    },
  });
}
