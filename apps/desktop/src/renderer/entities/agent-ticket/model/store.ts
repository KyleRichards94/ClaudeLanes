import { LANES, type BuildJob, type DesignSpecChange, type StageGates, type Effort, type Lane, type Model, type Stage, type TicketLastBuild, type TicketRecord } from '@agent-lanes/contracts';
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  ticketFromRecord,
  withActivity,
  withBuildJob,
  withDesignSpec,
  withGateOpened,
  withGateResolved,
  withGates,
  withLastBuild,
  withModelApplied,
  withModelRequested,
  withNeedsYou,
  withOutputAt,
  withPullRequest,
  withRun,
  withStage,
  withSubAgents,
  withoutNeedsYou,
} from './ticket';
import type {
  AgentTicket,
  AgentTicketPullRequest,
  AgentTicketRun,
  OtherNeedsYouKind,
  OtherNeedsYouReason,
  SubAgentCounts,
} from './types';

/**
 * Live agent tickets (design §6: one Zustand store per entity slice, fed by IPC events).
 *
 * - `byId` holds each ticket; a change to one ticket replaces only that ticket's object.
 * - `byLane` lists each lane's ticket ids, oldest entry first. A lane's array is replaced only when
 *   a ticket enters or leaves it, so a lane re-renders when its cards change lanes, never because a
 *   card in it is streaming.
 *
 * Components select one ticket or one lane (`selectTicket`, `selectLaneTicketIds`, …), so a burst
 * of output on one ticket re-renders that ticket's card and nothing else (§12 Performance).
 */
export interface AgentTicketsState {
  readonly byId: ReadonlyMap<string, AgentTicket>;
  readonly byLane: Readonly<Record<Lane, readonly string[]>>;
}

/**
 * The store, readable like any Zustand store (`useStore(store, selector)`); only these actions change
 * it. Each action is one commit, and an action that changes nothing commits nothing. Actions for an
 * unknown ticket id do nothing: events for a ticket the board has not loaded yet are dropped and the
 * board backfills when it loads the records (D155).
 */
export interface AgentTicketStore extends Pick<StoreApi<AgentTicketsState>, 'getState' | 'getInitialState' | 'subscribe'> {
  /** Shows exactly these tickets (start-up, AL-090). Tickets still present keep their live state. */
  load(records: readonly TicketRecord[]): void;
  /** Adds a ticket, or refreshes its record fields and keeps its live state (launch, AL-165). */
  upsert(record: TicketRecord): void;
  /** Takes a ticket off the board (Archive, AL-088, or a failed launch). */
  remove(ticketId: string): void;

  /** The ticket entered another lane (`set_stage`, AL-103; start from Queued, AL-111; Done, AL-087/AL-181). */
  setStage(ticketId: string, stage: Lane, at: number): void;
  /** The card's activity row and progress bar (`report_activity`, AL-103). */
  setActivity(ticketId: string, activity: { text: string | null; progress?: number | null }, at: number): void;
  /** A frame's batch of `agent:output` events, across tickets, in one commit. */
  recordOutput(events: readonly { readonly ticketId: string; readonly at: number }[]): void;

  /** A stage gate waits for the user (AL-104), with the agent's summary of what to approve (AL-254). */
  openGate(ticketId: string, stage: Stage, at: number, summary?: string | null): void;
  /** The waiting gate was approved, sent back or switched off (AL-104, AL-171). */
  resolveGate(ticketId: string): void;
  /** The ticket's stage gates after a toggle on the drill-in (`agent:setGate`, AL-171). */
  setGates(ticketId: string, gates: StageGates): void;
  /** A permission request (AL-109) or a QA gap; replaces the ticket's reason of the same kind. */
  setNeedsYou(ticketId: string, reason: OtherNeedsYouReason): void;
  clearNeedsYou(ticketId: string, kind: OtherNeedsYouKind): void;

  /** A model or effort change that applies from the next turn (AL-106, AL-172). */
  requestModelChange(ticketId: string, change: { model?: Model; effort?: Effort }, at: number): void;
  /** The session now runs with `applied`, or with the pending switch (AL-106). */
  applyModelChange(ticketId: string, applied?: { model: Model; effort: Effort }): void;

  setSubAgentCounts(ticketId: string, counts: SubAgentCounts): void;
  setPullRequest(ticketId: string, pullRequest: AgentTicketPullRequest | null): void;
  /** A `build:queued` update for one of the ticket's build or run jobs (AL-131). */
  applyBuildJob(job: Pick<BuildJob, 'ticketId' | 'jobId' | 'kind' | 'state' | 'position'>): void;
  setLastBuild(ticketId: string, build: TicketLastBuild): void;
  setRun(ticketId: string, run: AgentTicketRun): void;
  /** A `design:spec` event: a spec was shipped or acknowledged (AL-197, AL-198, AL-200). */
  setDesignSpec(ticketId: string, version: number, change: DesignSpecChange, at: number): void;
}

function emptyLanes(): Record<Lane, readonly string[]> {
  return Object.fromEntries(LANES.map((lane) => [lane, []])) as unknown as Record<Lane, readonly string[]>;
}

/** Lane order: oldest entry into the lane first, then oldest ticket, then id. */
function compareInLane(a: AgentTicket, b: AgentTicket): number {
  return a.stageEnteredAt - b.stageEnteredAt || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function insertInLane(ids: readonly string[], ticket: AgentTicket, byId: ReadonlyMap<string, AgentTicket>): string[] {
  const index = ids.findIndex((id) => {
    const other = byId.get(id);
    return other !== undefined && compareInLane(ticket, other) < 0;
  });
  return index === -1 ? [...ids, ticket.id] : [...ids.slice(0, index), ticket.id, ...ids.slice(index)];
}

/**
 * Applies changed tickets to the state. Only lanes a ticket entered or left get a new array, and a
 * ticket that moved within its lane order (a new `stageEnteredAt`) is re-placed.
 */
function applyChanges(state: AgentTicketsState, changed: readonly AgentTicket[], removed: readonly string[] = []): AgentTicketsState {
  if (changed.length === 0 && removed.length === 0) return state;
  const byId = new Map(state.byId);
  let byLane: Record<Lane, readonly string[]> | undefined;
  const lanes = () => (byLane ??= { ...state.byLane });

  for (const id of removed) {
    const previous = byId.get(id);
    if (!previous) continue;
    byId.delete(id);
    const laneIds = lanes();
    laneIds[previous.stage] = laneIds[previous.stage].filter((other) => other !== id);
  }

  for (const ticket of changed) {
    const previous = byId.get(ticket.id);
    byId.set(ticket.id, ticket);
    if (previous && previous.stage === ticket.stage && previous.stageEnteredAt === ticket.stageEnteredAt && previous.createdAt === ticket.createdAt) {
      continue;
    }
    const laneIds = lanes();
    if (previous) laneIds[previous.stage] = laneIds[previous.stage].filter((other) => other !== ticket.id);
    laneIds[ticket.stage] = insertInLane(laneIds[ticket.stage], ticket, byId);
  }

  return { byId, byLane: byLane ?? state.byLane };
}

export function createAgentTicketStore(): AgentTicketStore {
  const store = createStore<AgentTicketsState>()(() => ({ byId: new Map(), byLane: emptyLanes() }));

  /** One ticket through a pure change; commits only when the ticket changed. */
  const update = (ticketId: string, change: (ticket: AgentTicket) => AgentTicket) => {
    store.setState((state) => {
      const ticket = state.byId.get(ticketId);
      if (!ticket) return state;
      const next = change(ticket);
      return next === ticket ? state : applyChanges(state, [next]);
    });
  };

  return {
    getState: store.getState,
    getInitialState: store.getInitialState,
    subscribe: store.subscribe,

    load(records) {
      store.setState((state) => {
        const keep = new Set(records.map((record) => record.id));
        const removed = [...state.byId.keys()].filter((id) => !keep.has(id));
        const changed: AgentTicket[] = [];
        for (const record of records) {
          const previous = state.byId.get(record.id);
          const next = ticketFromRecord(record, previous);
          if (next !== previous) changed.push(next);
        }
        return applyChanges(state, changed, removed);
      });
    },

    upsert(record) {
      store.setState((state) => {
        const previous = state.byId.get(record.id);
        const next = ticketFromRecord(record, previous);
        return next === previous ? state : applyChanges(state, [next]);
      });
    },

    remove(ticketId) {
      store.setState((state) => (state.byId.has(ticketId) ? applyChanges(state, [], [ticketId]) : state));
    },

    setStage: (ticketId, stage, at) => update(ticketId, (ticket) => withStage(ticket, stage, at)),
    setActivity: (ticketId, activity, at) => update(ticketId, (ticket) => withActivity(ticket, activity, at)),

    recordOutput(events) {
      if (events.length === 0) return;
      store.setState((state) => {
        const changed = new Map<string, AgentTicket>();
        for (const event of events) {
          const ticket = changed.get(event.ticketId) ?? state.byId.get(event.ticketId);
          if (!ticket) continue;
          const next = withOutputAt(ticket, event.at);
          if (next !== ticket) changed.set(event.ticketId, next);
        }
        return applyChanges(state, [...changed.values()]);
      });
    },

    openGate: (ticketId, stage, at, summary = null) => update(ticketId, (ticket) => withGateOpened(ticket, stage, at, summary)),
    resolveGate: (ticketId) => update(ticketId, withGateResolved),
    setGates: (ticketId, gates) => update(ticketId, (ticket) => withGates(ticket, gates)),
    setNeedsYou: (ticketId, reason) => update(ticketId, (ticket) => withNeedsYou(ticket, reason)),
    clearNeedsYou: (ticketId, kind) => update(ticketId, (ticket) => withoutNeedsYou(ticket, kind)),

    requestModelChange: (ticketId, change, at) => update(ticketId, (ticket) => withModelRequested(ticket, change, at)),
    applyModelChange: (ticketId, applied) => update(ticketId, (ticket) => withModelApplied(ticket, applied)),

    setSubAgentCounts: (ticketId, counts) => update(ticketId, (ticket) => withSubAgents(ticket, counts)),
    setPullRequest: (ticketId, pullRequest) => update(ticketId, (ticket) => withPullRequest(ticket, pullRequest)),
    applyBuildJob: (job) => update(job.ticketId, (ticket) => withBuildJob(ticket, job)),
    setLastBuild: (ticketId, build) => update(ticketId, (ticket) => withLastBuild(ticket, build)),
    setRun: (ticketId, run) => update(ticketId, (ticket) => withRun(ticket, run)),
    setDesignSpec: (ticketId, version, change, at) => update(ticketId, (ticket) => withDesignSpec(ticket, version, change, at)),
  };
}

/** The app's agent ticket store. The event hub feeds it (`agentTicketEventHandlers`); components read it through the hooks. */
export const agentTickets: AgentTicketStore = createAgentTicketStore();
