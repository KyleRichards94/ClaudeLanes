import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { invoke, unwrap } from '@/shared/api';
import { agentTickets, type AgentTicketStore } from '../model/store';

/** The reconciled board (AL-090): records, "Worktree missing" flags and orphan worktrees. */
export const ticketBoardQueryKey = ['tickets', 'board'] as const;

/**
 * Loads the board from the main process (start-up reconciliation, AL-090) and puts the tickets in the
 * agent ticket store, so a restart shows the same cards: stage, model/effort and session id as saved.
 * The query data also holds `missingWorktrees` ("Worktree missing") and `orphans` (Adopt / Ignore).
 */
export function useTicketBoard(store: AgentTicketStore = agentTickets) {
  const query = useQuery({
    queryKey: ticketBoardQueryKey,
    queryFn: async () => unwrap(await invoke('tickets:board')),
    // Records change through main-process actions that refetch this; focus doesn't need to.
    staleTime: Infinity,
  });
  const tickets = query.data?.tickets;
  useEffect(() => {
    if (tickets) store.load(tickets);
  }, [store, tickets]);
  return query;
}

/** Adopt an orphan worktree as a ticket, or as a sub-branch of the ticket its folder names. */
export function useAdoptWorktree(store: AgentTicketStore = agentTickets) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (worktreePath: string) => unwrap(await invoke('tickets:adoptWorktree', { worktreePath })),
    onSuccess: ({ record }) => {
      store.upsert(record);
      void queryClient.invalidateQueries({ queryKey: ticketBoardQueryKey });
    },
  });
}

/** Ignore an orphan worktree from now on; its folder is left alone. */
export function useIgnoreWorktree() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (worktreePath: string) => unwrap(await invoke('tickets:ignoreWorktree', { worktreePath })),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ticketBoardQueryKey }),
  });
}
