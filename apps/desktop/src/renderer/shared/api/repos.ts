import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { RepoSettings, Settings } from '@agent-lanes/contracts';
import { invoke, unwrap } from './ipc';
import { settingsQueryKey } from './settings';

export const reposQueryKey = ['repos'] as const;

/** Registered repos for the Repo dropdown (artboard 1, AL-142) and the first-run picker (AL-047). */
export function useRepos() {
  return useQuery({
    queryKey: reposQueryKey,
    queryFn: async () => unwrap(await invoke('repos:list')),
    // Repos change only through the mutations below, which update this cache themselves.
    staleTime: Infinity,
  });
}

/** Keeps the repo list and the settings cache (which holds the same list) in step. */
function storeRepos(queryClient: QueryClient, repos: RepoSettings[]): void {
  queryClient.setQueryData(reposQueryKey, repos);
  queryClient.setQueryData<Settings>(settingsQueryKey, (settings) => (settings ? { ...settings, repos } : settings));
}

/**
 * Opens the native folder picker in the main process and registers the repo picked there.
 * Resolves the outcome: `added`, `existing`, `cancelled`, or `rejected` (the folder was not a git
 * work tree; main already showed why, so callers show nothing more). Rejects only on failures the
 * caller should report, such as git missing.
 */
export function useAddRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await invoke('repos:add')),
    onSuccess: (outcome) => storeRepos(queryClient, outcome.repos),
  });
}

/** Forgets a registered repo; its folder and worktrees are left on disk. */
export function useRemoveRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (path: string) => unwrap(await invoke('repos:remove', { path })),
    onSuccess: (outcome) => storeRepos(queryClient, outcome.repos),
  });
}
