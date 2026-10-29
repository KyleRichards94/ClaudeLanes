import { peerRoomId, type PeerFrame, type PeerRoom, type PeerRooms, type Result, type RoomMember, type TicketAdoRef, type TicketRecord, type TicketRoom } from '@agent-lanes/contracts';
import type { Emit } from '../ipc/emit';
import type { Logger } from '../logging';
import type { TicketRecordStore } from '../tickets';
import type { PeerEvent, PeerNetwork } from './network';
import { isLiveLane, laneOf, localMember } from './presence';

/**
 * Rooms and presence (AL-290, P2, P3, PL§4). A lane joins the room of its work item's nearest Feature
 * or Epic. Each lane's presence goes out as `hello` when it joins, `status` on a change and every
 * 30 s, `touched` when its files change, and `bye` when it leaves. Peers' lanes are kept from their
 * frames and expire 90 s after the last one.
 */

export const PRESENCE_MS = 30_000;
export const MEMBER_EXPIRY_MS = 90_000;
/** Room lookups a sync starts at most, so a board of old tickets doesn't flood Azure DevOps at start-up. */
const LOOKUPS_PER_SYNC = 5;

export interface PortfolioParentRef {
  id: number;
  type: string;
  title: string;
}

export interface LocalLane {
  record: TicketRecord;
  room: TicketRoom | null;
  touched: string[];
}

export type PresenceChange = 'joined' | 'updated' | 'left' | 'expired';

export interface PresenceEvent {
  room: string | null;
  change: PresenceChange;
  member: RoomMember;
  /** The frame that caused it, for a peer's lane. */
  frame?: PeerFrame;
}

export interface RoomsOptions {
  network: Pick<PeerNetwork, 'broadcast' | 'sendTo' | 'onFrame' | 'onPeer' | 'identity' | 'status'>;
  tickets: Pick<TicketRecordStore, 'list' | 'get' | 'update'>;
  /** The nearest Feature or Epic above the work item; null when there is none. */
  findParent: (ado: TicketAdoRef) => Promise<Result<PortfolioParentRef | null>>;
  /** Worktree-relative paths the lane changed, sub-branches included. */
  touched: (record: TicketRecord) => Promise<string[]>;
  emit?: Emit;
  log?: Pick<Logger, 'warn'>;
  now?: () => number;
  presenceMs?: number;
  expiryMs?: number;
}

export interface Rooms {
  /** Starts the 30 s presence loop and reads the board once. */
  start(): void;
  /** The ticket's room, looked up and saved on its record the first time. Null when there is none or ADO can't be read now. */
  ensureRoom(ticketId: string): Promise<TicketRoom | null>;
  /** Reads the board again: joins, leaves, and sends the presence that changed. */
  sync(): Promise<void>;
  /** A lane changed stage: its `status` goes out now, not at the next tick. */
  stageChanged(ticketId: string): void;
  /** The room a ticket's agent talks in: its own, or its lead's for a second agent (AL-266). */
  roomFor(ticketId: string): Promise<TicketRoom | null>;
  local(ticketId: string): LocalLane | undefined;
  /** This app's lanes in a room. */
  localIn(roomId: string): LocalLane[];
  /** Everyone in a room, this app's lanes first. */
  members(roomId: string): RoomMember[];
  view(unread?: (roomId: string) => number): PeerRooms;
  onPresence(listener: (event: PresenceEvent) => void): () => void;
  /** Says `bye` for every lane and stops the loop. */
  dispose(): void;
}

function memberKey(instance: string, ticketId: string): string {
  return `${instance}/${ticketId}`;
}

export function createRooms(options: RoomsOptions): Rooms {
  const now = options.now ?? Date.now;
  const presenceMs = options.presenceMs ?? PRESENCE_MS;
  const expiryMs = options.expiryMs ?? MEMBER_EXPIRY_MS;
  const listeners = new Set<(event: PresenceEvent) => void>();
  const locals = new Map<string, LocalLane & { sentStage: string; sentTouched: string; statusAt: number }>();
  const remote = new Map<string, { room: string | null; member: RoomMember }>();
  const lookups = new Map<string, Promise<TicketRoom | null>>();
  const timers: NodeJS.Timeout[] = [];
  let syncing: Promise<void> | null = null;

  function notify(event: PresenceEvent): void {
    for (const listen of listeners) listen(event);
    options.emit?.('peers:presence', { room: event.room, change: event.change, member: event.member });
  }

  function online(): boolean {
    return options.network.status().listener.state !== 'off';
  }

  function memberOf(lane: LocalLane): RoomMember {
    return localMember(options.network.identity(), laneOf(lane.record), lane.touched, now());
  }

  function say(lane: LocalLane, kind: 'hello' | 'status' | 'touched' | 'bye', to?: string): void {
    const draft = { kind, room: lane.room?.id ?? null, lane: laneOf(lane.record), ...(kind === 'touched' ? { data: { files: lane.touched } } : {}) };
    if (to) options.network.sendTo(to, draft);
    else options.network.broadcast(draft);
  }

  async function ensureRoom(ticketId: string): Promise<TicketRoom | null> {
    const record = await options.tickets.get(ticketId);
    if (!record) return null;
    if (record.room !== undefined) return record.room;
    if (!record.ado) {
      await options.tickets.update(ticketId, (current) => ({ ...current, room: null }));
      return null;
    }
    const ado = record.ado;
    const pending = lookups.get(ticketId);
    if (pending) return pending;
    const lookup = (async () => {
      const parent = await options.findParent(ado);
      if (!parent.ok) {
        options.log?.warn(`Peer lanes: the room of #${ado.workItemId} could not be read: ${parent.message}`);
        return null;
      }
      const room = parent.data ? { id: peerRoomId(ado.orgUrl, parent.data.id), parentId: parent.data.id, parentType: parent.data.type, parentTitle: parent.data.title.slice(0, 1_000) } : null;
      await options.tickets.update(ticketId, (current) => ({ ...current, room }));
      return room;
    })().finally(() => lookups.delete(ticketId));
    lookups.set(ticketId, lookup);
    return lookup;
  }

  async function syncNow(): Promise<void> {
    if (!online()) return;
    const records = (await options.tickets.list()).filter(isLiveLane);
    let lookupsLeft = LOOKUPS_PER_SYNC;
    const seen = new Set<string>();
    for (let record of records) {
      if (record.room === undefined && record.ado && lookupsLeft > 0) {
        lookupsLeft -= 1;
        await ensureRoom(record.id);
        record = (await options.tickets.get(record.id)) ?? record;
      }
      seen.add(record.id);
      const room = record.room ?? null;
      const touched = await options.touched(record).catch(() => [] as string[]);
      const before = locals.get(record.id);
      if (before && before.room?.id !== room?.id) {
        say(before, 'bye');
        notify({ room: before.room?.id ?? null, change: 'left', member: memberOf(before) });
      }
      const lane = { record, room, touched, sentStage: before?.room?.id === room?.id ? (before?.sentStage ?? '') : '', sentTouched: before?.room?.id === room?.id ? (before?.sentTouched ?? '') : '', statusAt: before?.statusAt ?? 0 };
      locals.set(record.id, lane);
      const joined = !before || before.room?.id !== room?.id;
      if (joined) {
        say(lane, 'hello');
        lane.sentStage = record.stage;
        lane.statusAt = now();
        notify({ room: room?.id ?? null, change: 'joined', member: memberOf(lane) });
      } else if (lane.sentStage !== record.stage || now() - lane.statusAt >= presenceMs - 1_000) {
        say(lane, 'status');
        const changed = lane.sentStage !== record.stage;
        lane.sentStage = record.stage;
        lane.statusAt = now();
        if (changed) notify({ room: room?.id ?? null, change: 'updated', member: memberOf(lane) });
      }
      const files = touched.join('\n');
      if (files !== lane.sentTouched) {
        say(lane, 'touched');
        lane.sentTouched = files;
        if (!joined) notify({ room: room?.id ?? null, change: 'updated', member: memberOf(lane) });
      }
    }
    for (const [ticketId, lane] of locals) {
      if (seen.has(ticketId)) continue;
      locals.delete(ticketId);
      say(lane, 'bye');
      notify({ room: lane.room?.id ?? null, change: 'left', member: memberOf(lane) });
    }
  }

  function sync(): Promise<void> {
    syncing ??= syncNow()
      .catch((cause) => options.log?.warn(`Peer lanes: presence failed: ${String(cause)}`))
      .finally(() => {
        syncing = null;
      });
    return syncing;
  }

  function onFrame(frame: PeerFrame): void {
    // A replay is what was said, not who is here now.
    if (!frame.lane || frame.from.person || frame.replay) return;
    const key = memberKey(frame.from.instance, frame.lane.ticketId);
    const known = remote.get(key);
    if (frame.kind === 'bye') {
      if (!known) return;
      remote.delete(key);
      notify({ room: known.room, change: 'left', member: known.member, frame });
      return;
    }
    const member: RoomMember = {
      instance: frame.from.instance,
      user: frame.from.user,
      host: frame.from.host,
      lane: frame.lane,
      touched: frame.kind === 'touched' ? (frame.data.files ?? []) : (known?.member.touched ?? []),
      lastSeenAt: now(),
      local: false,
      reachable: true,
    };
    if (known && known.room !== frame.room) notify({ room: known.room, change: 'left', member: known.member, frame });
    remote.set(key, { room: frame.room, member });
    const fresh = !known || known.room !== frame.room;
    if (fresh || frame.kind !== 'status' || known.member.lane.stage !== frame.lane.stage) notify({ room: frame.room, change: fresh ? 'joined' : 'updated', member, frame });
  }

  function onPeer(event: PeerEvent): void {
    if (event.change === 'online') {
      // A peer that just connected hears every lane at once instead of at the next tick.
      for (const lane of locals.values()) {
        say(lane, 'hello', event.instance);
        if (lane.touched.length > 0) say(lane, 'touched', event.instance);
      }
      return;
    }
    for (const [key, entry] of remote) {
      if (entry.member.instance !== event.instance) continue;
      if (event.reason === 'bye') {
        remote.delete(key);
        notify({ room: entry.room, change: 'left', member: entry.member });
      } else {
        entry.member = { ...entry.member, reachable: false };
        notify({ room: entry.room, change: 'updated', member: entry.member });
      }
    }
  }

  function expire(): void {
    const at = now();
    for (const [key, entry] of remote) {
      if (at - entry.member.lastSeenAt < expiryMs) continue;
      remote.delete(key);
      notify({ room: entry.room, change: 'expired', member: { ...entry.member, reachable: false } });
    }
  }

  function members(roomId: string): RoomMember[] {
    const mine = [...locals.values()].filter((lane) => lane.room?.id === roomId).map(memberOf);
    const theirs = [...remote.values()].filter((entry) => entry.room === roomId).map((entry) => entry.member);
    return [...mine, ...theirs];
  }

  const unsubscribe = [options.network.onFrame(onFrame), options.network.onPeer(onPeer)];

  return {
    start() {
      timers.push(setInterval(() => void sync(), presenceMs), setInterval(expire, Math.max(10, Math.min(presenceMs, expiryMs / 6))));
      for (const timer of timers) timer.unref();
      void sync();
    },
    ensureRoom,
    sync,
    stageChanged(ticketId) {
      if (locals.has(ticketId)) void sync();
    },
    async roomFor(ticketId) {
      const record = await options.tickets.get(ticketId);
      if (!record) return null;
      if (record.companion) return (await options.tickets.get(record.companion.of))?.room ?? null;
      return record.room ?? null;
    },
    local: (ticketId) => locals.get(ticketId),
    localIn: (roomId) => [...locals.values()].filter((lane) => lane.room?.id === roomId),
    members,
    view(unread) {
      const rooms = new Map<string, PeerRoom>();
      for (const lane of locals.values()) {
        if (!lane.room || rooms.has(lane.room.id)) continue;
        rooms.set(lane.room.id, { id: lane.room.id, parentId: lane.room.parentId, parentType: lane.room.parentType, parentTitle: lane.room.parentTitle, members: members(lane.room.id), unread: unread?.(lane.room.id) ?? 0 });
      }
      const others = [...remote.values()].filter((entry) => entry.room === null || !rooms.has(entry.room)).map((entry) => entry.member);
      return { rooms: [...rooms.values()], others };
    },
    onPresence(listen) {
      listeners.add(listen);
      return () => listeners.delete(listen);
    },
    dispose() {
      for (const stop of unsubscribe) stop();
      for (const timer of timers.splice(0)) clearInterval(timer);
      for (const lane of locals.values()) say(lane, 'bye');
      locals.clear();
    },
  };
}
