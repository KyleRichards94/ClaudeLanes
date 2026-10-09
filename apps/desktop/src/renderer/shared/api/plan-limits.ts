import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { EventHandlers } from './event-handlers';
import { invoke, unwrap } from './ipc';

/** `['agent', 'plan-limits']`: the claude.ai plan's 5-hour and 7-day windows (AL-258). */
export const planLimitsQueryKey = ['agent', 'plan-limits'] as const;

/** Read once with `agent:getPlanLimits`, then replaced by each `agent:planLimits` event; never polls. */
export function usePlanLimits() {
  return useQuery({
    queryKey: planLimitsQueryKey,
    queryFn: async () => unwrap(await invoke('agent:getPlanLimits')),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

/** `agent:planLimits` → the limits query. The app registers this with its event hub. */
export function planLimitsEventHandlers(queryClient: QueryClient): EventHandlers {
  return {
    'agent:planLimits': (event) => queryClient.setQueryData(planLimitsQueryKey, event.limits),
  };
}
