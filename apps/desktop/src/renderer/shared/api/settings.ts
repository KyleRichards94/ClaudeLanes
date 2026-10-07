import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SettingsPatch } from '@agent-lanes/contracts';
import { invoke, unwrap } from './ipc';

export const settingsQueryKey = ['settings'] as const;

/**
 * Every setting, for the settings panel and the new-ticket defaults (AL-146, AL-162–AL-164).
 * UI prefs (last repo and sprint, collapsed lanes, embed modes) are read from `useUiPrefs` instead,
 * which saves them without going through this cache.
 */
export function useSettings() {
  return useQuery({
    queryKey: settingsQueryKey,
    queryFn: async () => unwrap(await invoke('settings:get')),
    staleTime: Infinity,
  });
}

/** Saves a partial update; the cache takes the settings the main process returns. */
export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: SettingsPatch) => unwrap(await invoke('settings:update', patch)),
    onSuccess: (settings) => queryClient.setQueryData(settingsQueryKey, settings),
  });
}
