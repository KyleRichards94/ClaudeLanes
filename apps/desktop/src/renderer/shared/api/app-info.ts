import { useQuery } from '@tanstack/react-query';
import { invoke, unwrap } from './ipc';

export const appInfoQueryKey = ['app', 'info'] as const;

export function useAppInfo() {
  return useQuery({
    queryKey: appInfoQueryKey,
    queryFn: async () => unwrap(await invoke('app:getInfo')),
    staleTime: Infinity,
  });
}
