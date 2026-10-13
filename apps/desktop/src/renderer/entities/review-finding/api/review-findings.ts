import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { ReviewFinding } from '@agent-lanes/contracts';
import { invoke, unwrap } from '@/shared/api';
import { useTurnsSettled } from '@/shared/model';

export const reviewFindingsQueryKey = (ticketId: string) => ['review', 'findings', ticketId] as const;

/** Findings are read again this long after a turn ends, and never more often. */
export const REVIEW_FINDINGS_REFRESH_MS = 1_000;

const pending = new Map<string, ReturnType<typeof setTimeout>>();

function requestRefresh(queryClient: QueryClient, ticketId: string): void {
  if (pending.has(ticketId)) return;
  pending.set(
    ticketId,
    setTimeout(() => {
      pending.delete(ticketId);
      void queryClient.invalidateQueries({ queryKey: reviewFindingsQueryKey(ticketId), refetchType: 'active' }, { cancelRefetch: false });
    }, REVIEW_FINDINGS_REFRESH_MS),
  );
}

/** Drops waiting refreshes (tests). */
export function cancelReviewFindingsRefreshes(): void {
  for (const timer of pending.values()) clearTimeout(timer);
  pending.clear();
}

export interface UseReviewFindingsOptions {
  /**
   * More tickets whose output carries findings: the reviewer is often a second agent on its own ticket
   * (AL-266), and its turn ends in its own stream. The ticket's own turns always count.
   */
  watch?: readonly string[];
}

/**
 * The reviewer's findings for a ticket, parsed in the main process from the structured block the review
 * agent ends each file with (`review:findings`, AL-277). Read again once a second after a turn ends in
 * the ticket's output (or a watched second agent's), and on window focus.
 */
export function useReviewFindings(ticketId: string, options: UseReviewFindingsOptions = {}) {
  const queryClient = useQueryClient();
  const ids = [ticketId, ...(options.watch ?? []).filter((id) => id !== ticketId)];
  const settled = useTurnsSettled(ids);
  const seen = useRef(settled);

  useEffect(() => {
    // The transcript on screen when the view opens is not news: only later turns refresh it.
    if (seen.current === settled) return;
    seen.current = settled;
    requestRefresh(queryClient, ticketId);
  }, [settled, queryClient, ticketId]);

  return useQuery({
    queryKey: reviewFindingsQueryKey(ticketId),
    queryFn: async (): Promise<ReviewFinding[]> => unwrap(await invoke('review:findings', { ticketId })),
    staleTime: REVIEW_FINDINGS_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}
