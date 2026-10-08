import type { LaunchFromAdoRequest, LaunchFromAdoResponse, Result } from '@agent-lanes/contracts';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { agentTickets, type AgentTicketStore } from '@/entities/agent-ticket';
import { invoke, ticketsQueryKey, useAddRepo } from '@/shared/api';
import { markLaunchedTicket, showErrorRecovery, toast } from '@/shared/model';
import { showLaunchToast } from './undo';

/** A drop as the drag (AL-235), the keyboard "Send to lane" menu and the Backlog popout hand it over. */
export type AdoDrop = LaunchFromAdoRequest;

/** The team board's ADO queries (TB§6), refetched after every drop: the card may have moved or been assigned. */
export const TEAM_BOARD_QUERY_KEYS = [
  ['ado', 'teamBoard'],
  ['ado', 'activePrs'],
  ['ado', 'backlog'],
] as const;

/** Refusals the recheck gives (AL-236): shown as they are, with the board refreshed. */
const PLAIN_REFUSALS = new Set(['refused', 'moved', 'not-found', 'no-repo']);

function reasonOf(details: unknown): string | undefined {
  const reason = typeof details === 'object' && details !== null ? (details as { reason?: unknown }).reason : undefined;
  return typeof reason === 'string' ? reason : undefined;
}

/** The toast for a launch that did not happen. */
export function reportLaunchFailure(result: Extract<Result<unknown>, { ok: false }>, addRepo: () => void): void {
  const reason = reasonOf(result.details);
  if (result.code === 'VALIDATION' && reason === 'add-repo') {
    toast({ id: 'launch-from-ado', tone: 'warning', title: 'Repo not registered', body: result.message, actions: [{ label: 'Add repo', onPress: addRepo }] });
    return;
  }
  if (result.code === 'VALIDATION' && reason !== undefined && PLAIN_REFUSALS.has(reason)) {
    toast({ id: 'launch-from-ado', tone: 'warning', title: "The drop didn't start an agent", body: result.message });
    return;
  }
  // A missing scope opens Connections on that organisation; anything else has its recovery (AL-211).
  showErrorRecovery(result);
}

export function refreshTeamBoard(queryClient: QueryClient): void {
  for (const queryKey of TEAM_BOARD_QUERY_KEYS) void queryClient.invalidateQueries({ queryKey });
}

/**
 * Launch from the team board (AL-236): main rechecks the card, makes the one ADO change a To Do or
 * Failed drop makes, creates the worktree and starts the agent. On success the card is put on the board
 * and highlighted, and the success toast says what changed; a refusal says why and refreshes the board.
 * Resolves the launch, or null when it did not happen.
 */
export function useLaunchFromAdo(store: AgentTicketStore = agentTickets): (drop: AdoDrop) => Promise<LaunchFromAdoResponse | null> {
  const queryClient = useQueryClient();
  const addRepo = useAddRepo();
  return useCallback(
    async (drop: AdoDrop) => {
      const result = await invoke('agent:launchFromAdo', drop);
      refreshTeamBoard(queryClient);
      if (!result.ok) {
        reportLaunchFailure(result, () => addRepo.mutate());
        return null;
      }
      store.upsert(result.data.record);
      markLaunchedTicket(result.data.ticketId);
      void queryClient.invalidateQueries({ queryKey: ticketsQueryKey });
      // What changed, with Undo for 10 s or until the first turn ends (AL-237).
      showLaunchToast(result.data, {
        store,
        refresh: () => {
          refreshTeamBoard(queryClient);
          void queryClient.invalidateQueries({ queryKey: ticketsQueryKey });
        },
      });
      return result.data;
    },
    [addRepo, queryClient, store],
  );
}
