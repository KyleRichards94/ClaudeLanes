import type { GetPermissionResponse, PermissionDecision } from '@agent-lanes/contracts';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { invoke, unwrap, type EventHandlers } from '@/shared/api';

export const permissionQueryKey = (ticketId: string) => ['agent', ticketId, 'permission'] as const;

/**
 * The ticket's oldest waiting permission request (AL-109): read once, then replaced by each
 * `agent:permission` event (`permissionEventHandlers`), so a reloaded renderer still shows it.
 */
export function usePendingPermission(ticketId: string) {
  return useQuery({
    queryKey: permissionQueryKey(ticketId),
    queryFn: async (): Promise<GetPermissionResponse> => unwrap(await invoke('agent:getPermission', { ticketId })),
    staleTime: Infinity,
  });
}

/** Allow once / Allow for this ticket / Deny. */
export function useResolvePermission(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, decision }: { requestId: string; decision: PermissionDecision }) =>
      unwrap(await invoke('agent:resolvePermission', { ticketId, requestId, decision })),
    // Answered elsewhere or its turn ended: read what waits now.
    onSuccess: ({ resolved }) => {
      if (!resolved) void queryClient.invalidateQueries({ queryKey: permissionQueryKey(ticketId) });
    },
  });
}

/** `agent:permission` → the ticket's waiting request. The app registers these with its event hub. */
export function permissionEventHandlers(queryClient: QueryClient): EventHandlers {
  return {
    'agent:permission': ({ ticketId, waiting }) => {
      queryClient.setQueryData<GetPermissionResponse>(permissionQueryKey(ticketId), { request: waiting });
    },
  };
}
