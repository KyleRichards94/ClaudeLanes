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

export interface ResolvePermissionInput {
  requestId: string;
  decision: PermissionDecision;
  /** Deny with a reason the agent reads (AL-260). */
  reason?: string;
  /** Always allow: the rule to save on the repo (AL-260); the request's suggestion when left out. */
  rule?: string;
}

/** Allow once / Allow for this ticket / Always allow / Deny. */
export function useResolvePermission(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId, decision, reason, rule }: ResolvePermissionInput) =>
      unwrap(await invoke('agent:resolvePermission', { ticketId, requestId, decision, ...(reason ? { reason } : {}), ...(rule ? { rule } : {}) })),
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
