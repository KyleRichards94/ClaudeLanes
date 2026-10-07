import { useQuery } from '@tanstack/react-query';
import { invoke, unwrap } from './ipc';

export const designArtboardsQueryKey = (ticketId: string, canvasUrl: string | undefined) => ['design', ticketId, 'artboards', canvasUrl ?? null] as const;

/**
 * The linked canvas's artboards (`design:listArtboards`, AL-195). Claude Design pushes no events, so
 * the list is read again whenever the design tab shows (mount), when the window regains focus, and on
 * `refetch()` (the Refresh button). `canvasUrl` keys the list, so a relinked canvas starts fresh;
 * undefined (no canvas) reads nothing.
 */
export function useDesignArtboards(ticketId: string, canvasUrl: string | undefined) {
  return useQuery({
    queryKey: designArtboardsQueryKey(ticketId, canvasUrl),
    queryFn: async () => unwrap(await invoke('design:listArtboards', { ticketId })),
    enabled: canvasUrl !== undefined,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
    retry: false,
  });
}
