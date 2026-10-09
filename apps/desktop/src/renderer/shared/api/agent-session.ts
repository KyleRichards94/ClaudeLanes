import type { AgentSessionStatus } from '@agent-lanes/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invoke, unwrap } from './ipc';
import { sessionStatusQueryKey } from './session-status';

/**
 * Reconnect on the "MCP bridge lost the session" toast (AL-110): resumes the ticket's saved session in
 * its worktree. Resolves the error message when it could not, or null when it did.
 */
export async function reconnectSession(ticketId: string): Promise<string | null> {
  const result = await invoke('agent:reconnect', { ticketId });
  return result.ok ? null : result.message;
}

/** Reconnect from the status pill or the composer (AL-252): the returned status goes straight into the status query. */
export function useReconnectSession(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await invoke('agent:reconnect', { ticketId })),
    onSuccess: (status) => queryClient.setQueryData<AgentSessionStatus>(sessionStatusQueryKey(ticketId), status),
  });
}

/** Stop turn (AL-253): ends the running turn at its next tool boundary; the session stays live. */
export function useInterruptTurn(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await invoke('agent:interrupt', { ticketId })),
    onSuccess: (status) => queryClient.setQueryData<AgentSessionStatus>(sessionStatusQueryKey(ticketId), status),
  });
}

/** End session (AL-253): closes the session and its `claude` process; the worktree and branch stay. */
export function useStopSession(ticketId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await invoke('agent:stop', { ticketId })),
    onSuccess: ({ status }) => queryClient.setQueryData<AgentSessionStatus>(sessionStatusQueryKey(ticketId), status),
  });
}
