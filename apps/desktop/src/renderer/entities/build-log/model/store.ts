import type { BuildLogEvent } from '@agent-lanes/contracts';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { appendBuildLog, EMPTY_BUILD_LOG, type TicketBuildLog } from './log';

/**
 * Build and run output per ticket (design §6 live client state, fed by `build:log`). A ticket's log
 * object is replaced only when its own lines arrive, so the Build log tab of one ticket never
 * re-renders because another ticket is building.
 */
export interface BuildLogsState {
  readonly byTicket: ReadonlyMap<string, TicketBuildLog>;
}

export interface BuildLogStore extends Pick<StoreApi<BuildLogsState>, 'getState' | 'getInitialState' | 'subscribe'> {
  /** A frame's `build:log` batches, across tickets, in one commit. */
  append(events: readonly BuildLogEvent[]): void;
  /** Forgets a ticket's log (archive, tests). */
  clear(ticketId: string): void;
}

export function createBuildLogStore(maxRows?: number): BuildLogStore {
  const store = createStore<BuildLogsState>()(() => ({ byTicket: new Map() }));

  return {
    getState: store.getState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe,

    append(events) {
      if (events.length === 0) return;
      const perTicket = new Map<string, BuildLogEvent[]>();
      for (const event of events) {
        const list = perTicket.get(event.ticketId);
        if (list) list.push(event);
        else perTicket.set(event.ticketId, [event]);
      }
      const byTicket = new Map(store.getState().byTicket);
      for (const [ticketId, ticketEvents] of perTicket) {
        byTicket.set(ticketId, appendBuildLog(byTicket.get(ticketId) ?? EMPTY_BUILD_LOG, ticketEvents, maxRows));
      }
      store.setState({ byTicket });
    },

    clear(ticketId) {
      if (!store.getState().byTicket.has(ticketId)) return;
      const byTicket = new Map(store.getState().byTicket);
      byTicket.delete(ticketId);
      store.setState({ byTicket });
    },
  };
}

/** The app's build log store. */
export const buildLogs: BuildLogStore = createBuildLogStore();

export function selectBuildLog(state: BuildLogsState, ticketId: string): TicketBuildLog {
  return state.byTicket.get(ticketId) ?? EMPTY_BUILD_LOG;
}
