import { isSoloLane, ok, type PeerRoomId, type PeerRooms, type PeerUnread, type PostToRoomRequest, type Result, type RoomLog, type RoomMessage, type RoomSystemEvent } from '@agent-lanes/contracts';
import { LIVE_SESSION_STATES } from '../agent/send-to-ticket';
import type { SessionManager, SessionMessageInput } from '../agent/session-manager';
import type { PeerToolBackend } from '../agent/stages/peer-tools';
import type { GitService } from '../git';
import type { Emit } from '../ipc/emit';
import type { Logger } from '../logging';
import type { TicketRecordStore } from '../tickets';
import { createDelivery, type DeliveryLane } from './delivery';
import type { PeerNetwork } from './network';
import { createPeerPosting, roomTitle } from './posting';
import { systemRow, toRoomMessage, type RoomLogStore } from './room-log';
import type { PresenceChange, Rooms } from './rooms';

/** Presence that becomes a row in the log (AL-300); a lane's stage or files changing doesn't. */
const SYSTEM_EVENTS: Partial<Record<PresenceChange, RoomSystemEvent>> = { joined: 'joined', left: 'left', expired: 'lost' };

/**
 * Peer lanes put together (E18). What peers post reaches the room log and this app's agents only for
 * rooms this app's lanes are in (P10); a peer's lane saying `hello` in one of them gets this app's own
 * messages again (P7), once per peer and room until that peer goes.
 */
export interface PeerLanes {
  log(room: PeerRoomId, since?: string): Promise<Result<RoomLog>>;
  /** Rooms with members and unread counts (`peers:rooms`). */
  rooms(): PeerRooms;
  /** A person's post from the Room tab (`peers:post`). */
  personPost(request: PostToRoomRequest): Promise<Result<RoomMessage>>;
  markSeen(room: PeerRoomId, upTo: string): PeerUnread;
  /** What the `agent_lanes` room tools call (AL-292). */
  readonly tools: PeerToolBackend;
  /** Stops listening and finishes writing the room logs. */
  dispose(): Promise<void>;
}

export interface PeerLanesOptions {
  network: Pick<PeerNetwork, 'onFrame' | 'onPeer' | 'broadcast' | 'status' | 'identity'>;
  rooms: Pick<Rooms, 'localIn' | 'members' | 'onPresence' | 'view' | 'roomFor' | 'ensureRoom'>;
  roomLog: RoomLogStore;
  tickets: Pick<TicketRecordStore, 'get'>;
  git: Pick<GitService, 'status'>;
  sessions: Pick<SessionManager, 'status'>;
  /** Gives a lane's agent a message the way the composer does (AL-268): a live session takes it, an ended one is resumed, a lane with none gets one (AL-299). */
  wake: (ticketId: string, message: SessionMessageInput) => Promise<Result<{ held: boolean }>>;
  emit?: Emit;
  log?: Pick<Logger, 'warn'>;
  now?: () => number;
}

export function createPeerLanes(options: PeerLanesOptions): PeerLanes {
  const replayed = new Set<string>();
  const inRoom = (room: PeerRoomId | null): room is PeerRoomId => room !== null && options.rooms.localIn(room).length > 0;

  function lanesIn(room: string): DeliveryLane[] {
    return options.rooms.localIn(room).map((lane) => ({
      ticketId: lane.record.id,
      workItemId: lane.record.ado?.workItemId ?? null,
      live: LIVE_SESSION_STATES.has(options.sessions.status(lane.record.id).state),
      // Single-step lanes read the room but get no turns (AL-292).
      receives: !isSoloLane(lane.record.stage),
    }));
  }

  const delivery = createDelivery({
    lanesIn,
    me: () => options.network.identity().user,
    send: (ticketId, text) => {
      void options.wake(ticketId, { text, source: 'app' }).then((sent) => {
        if (!sent.ok) options.log?.warn(`Peer lanes: a room message for ${ticketId} was not delivered: ${sent.message}`);
      });
    },
    readLog: (room) => options.roomLog.read(room),
    roomTitle: (room) => {
      const lane = options.rooms.localIn(room)[0];
      return lane?.room ? roomTitle(lane.room) : room;
    },
    log: options.log,
  });

  const posting = createPeerPosting({ network: options.network, rooms: options.rooms, roomLog: options.roomLog, delivery, tickets: options.tickets, git: options.git, ...(options.emit ? { emit: options.emit } : {}) });

  const stops = [
    options.network.onFrame((frame) => {
      if (!inRoom(frame.room)) return;
      if (frame.kind === 'hello' && !frame.replay) {
        const key = `${frame.from.instance}|${frame.room}`;
        if (replayed.has(key)) return;
        replayed.add(key);
        void options.roomLog.replayTo(frame.from.instance, frame.room);
        return;
      }
      if (!options.roomLog.recordReceived(frame)) return;
      const message = toRoomMessage(frame, false);
      delivery.received(frame);
      delivery.noted(message);
      options.emit?.('peers:message', { message, unread: delivery.unread() });
    }),
    options.network.onPeer((event) => {
      if (event.change !== 'gone') return;
      for (const key of [...replayed]) if (key.startsWith(`${event.instance}|`)) replayed.delete(key);
    }),
    options.rooms.onPresence((event) => {
      const system = SYSTEM_EVENTS[event.change];
      // A peer's lane only in rooms this app is in (P10); this app's own lanes always, leaving included.
      if (system && event.room && (event.member.local || inRoom(event.room))) {
        const row = systemRow(system, event.room, event.member, (options.now ?? Date.now)());
        void options.roomLog.recordSystem(row);
        options.emit?.('peers:message', { message: row, unread: delivery.unread() });
      }
      if (event.change !== 'joined' || !event.room || !inRoom(event.room)) return;
      if (!event.member.local && event.frame?.kind === 'hello') delivery.memberJoined(event.room, event.member);
      if (event.member.local) delivery.laneJoined(event.member.lane.ticketId, event.room, options.rooms.members(event.room).filter((member) => !member.local));
    }),
  ];

  return {
    log: async (room, since) => ok(await options.roomLog.read(room, since)),
    rooms: () => options.rooms.view((room) => delivery.unreadIn(room)),
    personPost: (request) => posting.personPost(request),
    markSeen: (room, upTo) => delivery.markSeen(room, upTo),
    tools: posting,
    async dispose() {
      for (const stop of stops) stop();
      delivery.dispose();
      await options.roomLog.flush();
    },
  };
}
