import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AGENT_MESSAGE_LIMIT, skillCommand, type AgentSessionStatus } from '@agent-lanes/contracts';
import { invoke, sessionStatusQueryKey, unwrap } from '@/shared/api';

export { AGENT_MESSAGE_LIMIT };

export interface SendInput {
  text: string;
  /** "Steer now": delivered at the next tool boundary instead of after the turn (D11). */
  now?: boolean;
}

/** `agent:send` (AL-105): resolves `held: true` when the session is paused (D548). */
export function useSendMessage(ticketId: string) {
  return useMutation({
    mutationFn: async ({ text, now }: SendInput) =>
      unwrap(await invoke('agent:send', { ticketId, text, ...(now ? { priority: 'now' as const } : {}) })),
  });
}

/** A skill chip: `/skill-name` as the next user turn, exactly as typed in the terminal (design §7). */
export function useRunSkill(ticketId: string) {
  return useMutation({
    mutationFn: async (skill: string) => unwrap(await invoke('agent:send', { ticketId, text: skillCommand(skill) })),
  });
}

/**
 * Pause (interrupt the turn, hold later messages) and Resume (deliver them in order). The returned
 * status goes straight into the session status query, so the button flips before the event arrives.
 */
export function usePauseResume(ticketId: string) {
  const queryClient = useQueryClient();
  const store = (status: AgentSessionStatus) => queryClient.setQueryData<AgentSessionStatus>(sessionStatusQueryKey(ticketId), status);
  const pause = useMutation({ mutationFn: async () => unwrap(await invoke('agent:pause', { ticketId })), onSuccess: store });
  const resume = useMutation({ mutationFn: async () => unwrap(await invoke('agent:resume', { ticketId })), onSuccess: store });
  return { pause, resume };
}
