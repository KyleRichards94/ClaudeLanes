import { useMutation } from '@tanstack/react-query';
import type { NextActionsResponse } from '@agent-lanes/contracts';
import { invoke, unwrap } from '@/shared/api';

/** "Generate next actions" (AL-272): one short Claude session over the digest text. */
export function useNextActions() {
  return useMutation({ mutationFn: async (digest: string): Promise<NextActionsResponse> => unwrap(await invoke('agent:nextActions', { digest })) });
}

/** "Send to agent": the suggestion goes to the ticket's agent as a message (AL-268 brings a stopped one back). */
export function useSendSuggestion() {
  return useMutation({ mutationFn: async ({ ticketId, text }: { ticketId: string; text: string }) => unwrap(await invoke('agent:send', { ticketId, text, priority: 'next' })) });
}
