import { useQuery } from '@tanstack/react-query';
import { invoke, unwrap } from './ipc';

export const workItemQueryKey = (id: number) => ['ado', 'workItem', id] as const;

/**
 * One Azure DevOps work item (`ado:getWorkItem`), for the drill-in's meta chips and "Open in Azure
 * DevOps ↗" (AL-170). ADO data refetches on window focus and every 60 s while shown (design §6).
 * Pass `undefined` for a "No ticket" ticket; nothing is fetched. AL-066 owns the wider ADO query set.
 */
export function useWorkItem(id: number | undefined) {
  return useQuery({
    queryKey: workItemQueryKey(id ?? 0),
    queryFn: async () => unwrap(await invoke('ado:getWorkItem', { id: id ?? 0 })),
    enabled: id !== undefined,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}
