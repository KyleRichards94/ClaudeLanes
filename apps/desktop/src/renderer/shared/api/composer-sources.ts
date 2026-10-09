import { useQuery } from '@tanstack/react-query';
import { invoke, unwrap } from './ipc';

/** `['agent', ticketId, 'commands']`: the slash commands the ticket's session lists (AL-259). */
export const sessionCommandsQueryKey = (ticketId: string) => ['agent', ticketId, 'commands'] as const;

/** The session's own commands (`supportedCommands()`), for the composer's `/` menu beside the repo's skills. */
export function useSessionCommands(ticketId: string, enabled = true) {
  return useQuery({
    queryKey: sessionCommandsQueryKey(ticketId),
    queryFn: async () => unwrap(await invoke('agent:listCommands', { ticketId })),
    enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** `['git', ticketId, 'files', query]`: worktree files matching the `@` query (AL-259). */
export const worktreeFilesQueryKey = (ticketId: string, query: string) => ['git', ticketId, 'files', query] as const;

export function useWorktreeFiles(ticketId: string, query: string, enabled = true) {
  return useQuery({
    queryKey: worktreeFilesQueryKey(ticketId, query),
    queryFn: async () => unwrap(await invoke('git:listFiles', { ticketId, query })),
    enabled,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: false,
    retry: false,
  });
}
