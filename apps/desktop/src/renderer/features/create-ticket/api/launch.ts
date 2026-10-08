import type { LaunchTicketRequest, LaunchTicketResponse } from '@agent-lanes/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { agentTickets, type AgentTicketStore } from '@/entities/agent-ticket';
import { invoke, ticketsQueryKey } from '@/shared/api';
import { markLaunchedTicket, showErrorRecovery } from '@/shared/model';
import type { NewTicketRequest } from '../model/form';

/** Why Launch can't go ahead without a repo (the board has none registered yet). */
export const NO_REPO_MESSAGE = 'Add a repo in Settings before launching an agent: the worktree is made in it.';

/** The modal's request as `tickets:launch` takes it. Null when there is no repo to launch in. */
export function toLaunchRequest(request: NewTicketRequest): LaunchTicketRequest | null {
  if (!request.repo) return null;
  return {
    repo: request.repo,
    workItem: request.workItem ? { id: request.workItem.id, title: request.workItem.title } : null,
    description: request.description,
    skills: [...request.skills],
    model: request.model,
    effort: request.effort,
    gates: { ...request.gates },
    worktreeName: request.worktreeName,
  };
}

/**
 * Launch (AL-165): asks main to create the worktree and record and start the session (or queue it),
 * then puts the card on the board and highlights it. A refusal rejects with its message, which the
 * modal shows under the summary; anything but a plain refusal also raises its recovery toast (AL-211:
 * Reconnect for ADO, Copy diagnostics, …).
 */
export function useLaunchTicket(store: AgentTicketStore = agentTickets): (request: NewTicketRequest) => Promise<LaunchTicketResponse> {
  const queryClient = useQueryClient();
  return useCallback(
    async (request: NewTicketRequest) => {
      const launch = toLaunchRequest(request);
      if (!launch) throw new Error(NO_REPO_MESSAGE);
      const result = await invoke('tickets:launch', launch);
      if (!result.ok) {
        if (result.code !== 'VALIDATION') showErrorRecovery(result);
        throw new Error(result.message);
      }
      store.upsert(result.data.record);
      markLaunchedTicket(result.data.record.id);
      void queryClient.invalidateQueries({ queryKey: ticketsQueryKey });
      return result.data;
    },
    [queryClient, store],
  );
}
