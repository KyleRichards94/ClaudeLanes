import { useStore } from 'zustand';
import type { EventHandlers } from '@/shared/api';
import type { TicketBuildLog } from './log';
import { buildLogs, selectBuildLog, type BuildLogStore } from './store';

/** One ticket's build log; re-renders only when that ticket's lines arrive. `store` is for tests. */
export function useBuildLog(ticketId: string, store: BuildLogStore = buildLogs): TicketBuildLog {
  return useStore(store, (state) => selectBuildLog(state, ticketId));
}

/** The build log store's handlers for the app's event hub: `build:log` arrives as one batch per frame. */
export function createBuildLogEventHandlers(store: BuildLogStore): EventHandlers {
  return {
    'build:log': (events) => store.append(events),
  };
}

export const buildLogEventHandlers: EventHandlers = createBuildLogEventHandlers(buildLogs);
