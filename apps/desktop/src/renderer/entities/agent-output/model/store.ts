import { TRANSCRIPT_CAPACITY, type AgentOutputEvent, type AgentTranscript } from '@agent-lanes/contracts';
import { createStore, type StoreApi } from 'zustand/vanilla';

/**
 * Each watched ticket's output stream (AL-102, design §6 Live events): what the drill-in's Output tab
 * (AL-175) draws. A ticket is watched from the moment a view asks for its output; from then on live
 * `agent:output` events are kept, and the backfill from `agent:getTranscript` is merged in by `seq`,
 * so prior output shows first and live output continues with no gap or duplicate, however the two
 * interleave.
 */
export interface TicketOutput {
  /** Oldest first, by seq, at most TRANSCRIPT_CAPACITY. */
  readonly events: readonly AgentOutputEvent[];
  /** True once the backfill from main has been merged. */
  readonly backfilled: boolean;
}

export interface AgentOutputState {
  readonly byTicket: ReadonlyMap<string, TicketOutput>;
}

export interface AgentOutputStore extends Pick<StoreApi<AgentOutputState>, 'getState' | 'getInitialState' | 'subscribe'> {
  /** Starts keeping the ticket's live output. Returns true when it was not watched yet. */
  watch(ticketId: string): boolean;
  /** A frame's batch of `agent:output` events; events of tickets nobody watches are dropped. */
  receive(events: readonly AgentOutputEvent[]): void;
  /** Merges the ticket's transcript from main. */
  backfill(transcript: AgentTranscript): void;
  /** Stops keeping the ticket's output (e.g. the ticket was archived). */
  forget(ticketId: string): void;
}

const EMPTY: readonly AgentOutputEvent[] = [];

function newest(events: AgentOutputEvent[], capacity: number): AgentOutputEvent[] {
  return events.length > capacity ? events.slice(events.length - capacity) : events;
}

/** Events from both lists, one per seq (the later list wins), in seq order, newest `capacity` kept. */
export function mergeOutput(
  existing: readonly AgentOutputEvent[],
  incoming: readonly AgentOutputEvent[],
  capacity = TRANSCRIPT_CAPACITY,
): readonly AgentOutputEvent[] {
  if (incoming.length === 0) return existing;
  // The common case, live output in order after what is kept: append without re-sorting.
  let previous = existing.at(-1)?.seq ?? Number.NEGATIVE_INFINITY;
  const inOrder = incoming.every((event) => {
    const after = event.seq > previous;
    previous = event.seq;
    return after;
  });
  if (inOrder) return newest([...existing, ...incoming], capacity);

  const bySeq = new Map<number, AgentOutputEvent>();
  for (const event of existing) bySeq.set(event.seq, event);
  for (const event of incoming) bySeq.set(event.seq, event);
  return newest(
    [...bySeq.values()].sort((a, b) => a.seq - b.seq),
    capacity,
  );
}

/**
 * Drops streamed deltas that a finished `text` with the same stream id supersedes (main's buffer does
 * the same), so a backfill and the live stream agree.
 */
function withoutSupersededDeltas(events: readonly AgentOutputEvent[]): readonly AgentOutputEvent[] {
  const finished = new Set<string>();
  for (const { item } of events) if (item.kind === 'text') finished.add(`${item.parentToolUseId ?? ''}:${item.streamId}`);
  if (finished.size === 0) return events;
  const kept = events.filter(({ item }) => !(item.kind === 'text-delta' && finished.has(`${item.parentToolUseId ?? ''}:${item.streamId}`)));
  return kept.length === events.length ? events : kept;
}

export function createAgentOutputStore(capacity = TRANSCRIPT_CAPACITY): AgentOutputStore {
  const store = createStore<AgentOutputState>()(() => ({ byTicket: new Map() }));

  return {
    getState: store.getState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe,

    watch(ticketId) {
      if (store.getState().byTicket.has(ticketId)) return false;
      store.setState((state) => {
        const byTicket = new Map(state.byTicket);
        byTicket.set(ticketId, { events: EMPTY, backfilled: false });
        return { byTicket };
      });
      return true;
    },

    receive(events) {
      if (events.length === 0) return;
      store.setState((state) => {
        const grouped = new Map<string, AgentOutputEvent[]>();
        for (const event of events) {
          if (!state.byTicket.has(event.ticketId)) continue;
          const list = grouped.get(event.ticketId) ?? [];
          list.push(event);
          grouped.set(event.ticketId, list);
        }
        if (grouped.size === 0) return state;
        const byTicket = new Map(state.byTicket);
        for (const [ticketId, list] of grouped) {
          const output = byTicket.get(ticketId);
          if (output) byTicket.set(ticketId, { ...output, events: withoutSupersededDeltas(mergeOutput(output.events, list, capacity)) });
        }
        return { byTicket };
      });
    },

    backfill(transcript) {
      store.setState((state) => {
        const output = state.byTicket.get(transcript.ticketId);
        if (!output) return state;
        const byTicket = new Map(state.byTicket);
        // Live events kept while main answered win over the same seq in the transcript.
        byTicket.set(transcript.ticketId, { events: withoutSupersededDeltas(mergeOutput(transcript.events, output.events, capacity)), backfilled: true });
        return { byTicket };
      });
    },

    forget(ticketId) {
      store.setState((state) => {
        if (!state.byTicket.has(ticketId)) return state;
        const byTicket = new Map(state.byTicket);
        byTicket.delete(ticketId);
        return { byTicket };
      });
    },
  };
}

/** The app's output store; the event hub feeds it (`agentOutputEventHandlers`). */
export const agentOutput: AgentOutputStore = createAgentOutputStore();

/** A ticket's events, or an empty list while it is not watched. */
export function selectTicketOutput(state: AgentOutputState, ticketId: string): readonly AgentOutputEvent[] {
  return state.byTicket.get(ticketId)?.events ?? EMPTY;
}
