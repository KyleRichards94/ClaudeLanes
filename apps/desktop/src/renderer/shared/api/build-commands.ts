import { useQuery } from '@tanstack/react-query';
import { invoke, unwrap } from './ipc';

export const repoCommandsQueryKey = (repoPath: string) => ['build', 'commands', repoPath] as const;

/**
 * A registered repo's build and run commands: what its files give and what Build and Run will use
 * (AL-130, `build:commands`). The settings panel shows the detected commands beside the overrides
 * (AL-146). Detection reads the repo's files each time, so it refetches on window focus.
 */
export function useRepoCommands(repoPath: string | null) {
  return useQuery({
    queryKey: repoCommandsQueryKey(repoPath ?? ''),
    queryFn: async () => unwrap(await invoke('build:commands', { repoPath: repoPath ?? '' })),
    enabled: repoPath !== null,
  });
}
