import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateTicketPullRequestRequest, TicketPullRequestState } from '@agent-lanes/contracts';
import { agentTickets, type AgentTicketStore } from '@/entities/agent-ticket';
import { invoke, ticketRecordQueryKey, unwrap } from '@/shared/api';

export const pullRequestDraftQueryKey = (ticketId: string) => ['tickets', ticketId, 'pr', 'draft'] as const;
export const ticketPullRequestQueryKey = (ticketId: string) => ['tickets', ticketId, 'pr', 'state'] as const;

/** How often the drill-in reads the PR's checks while it shows them; main also polls open PRs (AL-181). */
export const PULL_REQUEST_REFETCH_MS = 30_000;

/** The Create PR form's starting title and description, and why a PR can't be created yet (`pr:draft`). */
export function usePullRequestDraft(ticketId: string, enabled: boolean) {
  return useQuery({
    queryKey: pullRequestDraftQueryKey(ticketId),
    queryFn: async () => unwrap(await invoke('pr:draft', { ticketId })),
    enabled,
    // The draft is a starting point; reading it again would overwrite nothing the user typed, but costs a git call.
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** The ticket's PR and its checks, read again from ADO (`pr:get`); null when it has none. */
export function useTicketPullRequest(ticketId: string, enabled: boolean) {
  return useQuery({
    queryKey: ticketPullRequestQueryKey(ticketId),
    queryFn: async () => unwrap(await invoke('pr:get', { ticketId })).state,
    enabled,
    refetchInterval: PULL_REQUEST_REFETCH_MS,
  });
}

function toStore(store: AgentTicketStore, ticketId: string, state: TicketPullRequestState): void {
  const { checks } = state.snapshot;
  store.setPullRequest(ticketId, { id: state.pullRequest.id, status: state.pullRequest.status, checks: { passed: checks.passed, total: checks.total, pending: checks.pending } });
}

/** Pushes the branch and opens the PR (`pr:create`); the card shows "PR !10612" straight away. */
export function useCreatePullRequest(store: AgentTicketStore = agentTickets) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: CreateTicketPullRequestRequest) => unwrap(await invoke('pr:create', request)),
    onSuccess: (result, request) => {
      toStore(store, request.ticketId, result);
      queryClient.setQueryData(ticketPullRequestQueryKey(request.ticketId), result);
      void queryClient.invalidateQueries({ queryKey: ticketRecordQueryKey(request.ticketId) });
    },
  });
}
