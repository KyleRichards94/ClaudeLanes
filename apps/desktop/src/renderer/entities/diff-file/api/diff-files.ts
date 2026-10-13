import { useEffect, useRef } from 'react';
import { useQuery, type QueryClient, useQueryClient } from '@tanstack/react-query';
import type { DiffFilesResponse } from '@agent-lanes/contracts';
import { invoke, unwrap } from '@/shared/api';
import { useOutputSettle } from '@/shared/model';

export const diffFilesQueryKey = (ticketId: string) => ['diff', 'files', ticketId] as const;

/** The list is read again this long after the output shows a file-changing call settle, and never more often. */
export const DIFF_FILES_REFRESH_MS = 1_000;

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Reads the ticket's changed files again after `DIFF_FILES_REFRESH_MS`. Calls while one is waiting join
 * it, so a burst of edits costs one read per second at most, however many views ask.
 */
export function requestDiffFilesRefresh(queryClient: QueryClient, ticketId: string): void {
  if (pending.has(ticketId)) return;
  pending.set(
    ticketId,
    setTimeout(() => {
      pending.delete(ticketId);
      void queryClient.invalidateQueries({ queryKey: diffFilesQueryKey(ticketId), refetchType: 'active' }, { cancelRefetch: false });
    }, DIFF_FILES_REFRESH_MS),
  );
}

/** Drops waiting refreshes (tests). */
export function cancelDiffFilesRefreshes(): void {
  for (const timer of pending.values()) clearTimeout(timer);
  pending.clear();
}

/**
 * Every file the ticket changed against its base, with author, line counts, whether the change is only
 * in the working tree, and the review status per file (`diff:files`, AL-276). Read again when an Edit or
 * Write (or a Bash call or a turn end) settles in the live output, at most once a second, and on window
 * focus. Both layouts read it, so they never disagree about the city or the change map.
 */
export function useDiffFiles(ticketId: string) {
  const queryClient = useQueryClient();
  const settled = useOutputSettle(ticketId).files;
  const seen = useRef(settled);

  useEffect(() => {
    // The transcript on screen when the view opens is not news: only later calls refresh it.
    if (seen.current === settled) return;
    seen.current = settled;
    requestDiffFilesRefresh(queryClient, ticketId);
  }, [settled, queryClient, ticketId]);

  return useQuery({
    queryKey: diffFilesQueryKey(ticketId),
    queryFn: async (): Promise<DiffFilesResponse> => unwrap(await invoke('diff:files', { ticketId })),
    staleTime: DIFF_FILES_REFRESH_MS,
    refetchOnWindowFocus: true,
  });
}
