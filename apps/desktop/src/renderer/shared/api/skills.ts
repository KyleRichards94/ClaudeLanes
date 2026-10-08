import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke, unwrap } from './ipc';

/** `['skills', repo]`: a registered repo's skills as Claude Code lists them (AL-114). */
export function skillsQueryKey(repo: string) {
  return ['skills', repo] as const;
}

/**
 * The skills of a repo for the skill chips (artboard 2, artboard 3 shortcuts). Main caches the list
 * per repo, so this reads it once per repo; `useRefreshSkills` asks Claude Code again.
 */
export function useSkills(repo: string | null | undefined) {
  return useQuery({
    queryKey: skillsQueryKey(repo ?? ''),
    queryFn: async () => unwrap(await invoke('skills:list', { repo: repo ?? '' })),
    enabled: Boolean(repo),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

/** Lists the repo's skills again (a new skill was added to `.claude/skills` while the app ran). */
export function useRefreshSkills(repo: string | null | undefined) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await invoke('skills:list', { repo: repo ?? '', refresh: true })),
    onSuccess: (data) => client.setQueryData(skillsQueryKey(repo ?? ''), data),
  });
}
