import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { RewindResponse } from '@agent-lanes/contracts';
import { branchesQueryKey, invoke, unwrap } from '@/shared/api';

/** Rewind to here (AL-265): a dry run previews the files; the real one restores them and refreshes the diff. */
export function useRewind(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, dryRun }: { messageId: string; dryRun: boolean }): Promise<RewindResponse> => unwrap(await invoke('agent:rewind', { ticketId, messageId, dryRun })),
    onSuccess: (result) => {
      if (!result.dryRun) void queryClient.invalidateQueries({ queryKey: branchesQueryKey(ticketId) });
    },
  });
}
