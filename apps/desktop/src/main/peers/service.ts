import { ok, type PeerRoomId, type Result, type RoomLog } from '@agent-lanes/contracts';
import type { PeerNetwork } from './network';
import type { RoomLogStore } from './room-log';
import type { Rooms } from './rooms';

/**
 * Peer lanes put together (E18). What peers post reaches the room log only for rooms this app's lanes
 * are in (P10); a peer's lane saying `hello` in one of them gets this app's own messages again (P7),
 * once per peer and room until that peer goes.
 */
export interface PeerLanes {
  log(room: PeerRoomId, since?: string): Promise<Result<RoomLog>>;
  /** Stops listening and finishes writing the room logs. */
  dispose(): Promise<void>;
}

export interface PeerLanesOptions {
  network: Pick<PeerNetwork, 'onFrame' | 'onPeer'>;
  rooms: Pick<Rooms, 'localIn'>;
  roomLog: RoomLogStore;
}

export function createPeerLanes(options: PeerLanesOptions): PeerLanes {
  const replayed = new Set<string>();
  const inRoom = (room: PeerRoomId | null): room is PeerRoomId => room !== null && options.rooms.localIn(room).length > 0;

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
      options.roomLog.recordReceived(frame);
    }),
    options.network.onPeer((event) => {
      if (event.change !== 'gone') return;
      for (const key of [...replayed]) if (key.startsWith(`${event.instance}|`)) replayed.delete(key);
    }),
  ];

  return {
    log: async (room, since) => ok(await options.roomLog.read(room, since)),
    async dispose() {
      for (const stop of stops) stop();
      await options.roomLog.flush();
    },
  };
}
