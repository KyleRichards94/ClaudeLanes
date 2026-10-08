import { useQuery, type QueryClient } from '@tanstack/react-query';
import { invoke, unwrap } from './ipc';
import type { EventHandlers } from './event-handlers';

/** `['branches', ticketId]` (design §6): a ticket's branch status (AL-085). Merges invalidate it. */
export function branchesQueryKey(ticketId: string) {
  return ['branches', ticketId] as const;
}

/**
 * The ticket branch against its base and each sub-branch against the ticket branch: ahead/behind,
 * dirty, and Ready (clean and its sub-agent finished), for the Sub-branches and Merge panels (artboard 3).
 */
export function useBranchStatus(ticketId: string) {
  return useQuery({
    queryKey: branchesQueryKey(ticketId),
    queryFn: async () => unwrap(await invoke('branches:status', { ticketId })),
  });
}

/**
 * Event handlers that keep branch status current: a sub-agent that starts or finishes (`agent:subagent`,
 * AL-107) changes its branch and whether it is ready, so the ticket's status is read again. Progress
 * updates in between change neither and are ignored. The lead agent commits in the ticket worktree
 * during its turns, so a turn ending (`agent:status` idle) and a stage change (`agent:stage`) read it
 * again too (AL-222: the Merge panel kept showing a change the agent had since committed). The app
 * registers these with its event hub once the query client exists.
 */
export function createBranchStatusEventHandlers(queryClient: QueryClient): EventHandlers {
  const refresh = (ticketId: string) => void queryClient.invalidateQueries({ queryKey: branchesQueryKey(ticketId) });
  return {
    'agent:subagent': (event) => {
      if (event.change !== 'updated') refresh(event.ticketId);
    },
    'agent:status': (event) => {
      if (event.state === 'idle') refresh(event.ticketId);
    },
    'agent:stage': (event) => {
      if (event.change === 'stage') refresh(event.ticketId);
    },
  };
}
