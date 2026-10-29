import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { RoomMessageSchema, isPeerPostKind, type PeerFrame, type PeerRoomId, type RoomLog, type RoomMessage } from '@agent-lanes/contracts';
import type { Logger } from '../logging';
import type { FrameDraft, PeerNetwork } from './network';

/**
 * The room log (AL-291, P7, P9). Each app keeps only what it said: its own frames per room, in memory
 * and in `<userData>/peers/rooms/<hash>.json` (the last 200, at most 7 days old). What peers said is
 * kept in memory for the session. A peer's lane that says `hello` in a room gets this app's own
 * frames for that room again, marked `replay` (the network paces them).
 */

export const OWN_LOG_MAX = 200;
export const OWN_LOG_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/** Messages kept per room for the session, own and received. */
const ROOM_LOG_MAX = 1_000;
const LOG_FILE_VERSION = 1;

const LogFileSchema = z.object({
  version: z.literal(LOG_FILE_VERSION),
  room: z.string(),
  capped: z.boolean(),
  messages: z.array(RoomMessageSchema),
});

export function roomLogsDir(peersDir: string): string {
  return join(peersDir, 'rooms');
}

/** A room's file name: a hash of its id, so an organisation URL never becomes a path. */
export function roomLogFile(dir: string, room: PeerRoomId): string {
  return join(dir, `${createHash('sha256').update(room).digest('hex').slice(0, 24)}.json`);
}

/** Frames that belong in the readable log: what agents and people post. Joins and leaves are presence. */
export function isLoggedKind(kind: PeerFrame['kind']): boolean {
  return isPeerPostKind(kind);
}

export function toRoomMessage(frame: PeerFrame, own: boolean): RoomMessage {
  const { sig: _sig, team: _team, ...fields } = frame;
  return { ...fields, own };
}

interface RoomState {
  own: RoomMessage[];
  /** Own messages were dropped at the cap. */
  capped: boolean;
  all: RoomMessage[];
  /** Replayed messages received per peer instance, to tell whether its log was capped. */
  replays: Map<string, number>;
  loaded: Promise<void> | null;
}

export interface RoomLogStore {
  /** A frame this app sent into a room. */
  recordOwn(frame: PeerFrame): Promise<void>;
  /** A frame a peer sent into a room this app is in. Replays of messages already held are ignored. */
  recordReceived(frame: PeerFrame): boolean;
  read(room: PeerRoomId, since?: string): Promise<RoomLog>;
  /** Sends this app's own frames for `room` to one peer, oldest first, marked replay. */
  replayTo(instance: string, room: PeerRoomId): Promise<number>;
  /** Writes any pending file now. */
  flush(): Promise<void>;
}

export interface RoomLogOptions {
  dir: string;
  network: Pick<PeerNetwork, 'sendTo'>;
  now?: () => number;
  log?: Pick<Logger, 'warn'>;
}

export function createRoomLog(options: RoomLogOptions): RoomLogStore {
  const now = options.now ?? Date.now;
  const rooms = new Map<string, RoomState>();
  let writes: Promise<void> = Promise.resolve();
  const dirty = new Set<PeerRoomId>();

  function state(room: PeerRoomId): RoomState {
    let found = rooms.get(room);
    if (!found) {
      found = { own: [], capped: false, all: [], replays: new Map(), loaded: null };
      rooms.set(room, found);
    }
    return found;
  }

  function fresh(message: RoomMessage): boolean {
    return now() - Date.parse(message.sentAt) <= OWN_LOG_MAX_AGE_MS;
  }

  async function load(room: PeerRoomId): Promise<RoomState> {
    const found = state(room);
    found.loaded ??= (async () => {
      try {
        const file = LogFileSchema.parse(JSON.parse(await readFile(roomLogFile(options.dir, room), 'utf8')));
        if (file.room !== room) return;
        const kept = file.messages.filter(fresh).map((message) => ({ ...message, own: true }));
        found.own = [...kept, ...found.own].slice(-OWN_LOG_MAX);
        found.capped = file.capped;
        const ids = new Set(found.all.map((message) => message.id));
        found.all = [...kept.filter((message) => !ids.has(message.id)), ...found.all];
        sortAll(found);
      } catch (cause) {
        if ((cause as { code?: string }).code !== 'ENOENT') options.log?.warn(`Peer lanes: the room log for ${room} could not be read; starting it again.`);
      }
    })();
    await found.loaded;
    return found;
  }

  function sortAll(found: RoomState): void {
    found.all.sort((a, b) => Date.parse(a.sentAt) - Date.parse(b.sentAt));
    if (found.all.length > ROOM_LOG_MAX) found.all.splice(0, found.all.length - ROOM_LOG_MAX);
  }

  /** Queues a write of the room's file; posts that arrive while one is queued share it. */
  function save(room: PeerRoomId, found: RoomState): void {
    if (dirty.has(room)) return;
    dirty.add(room);
    const file = roomLogFile(options.dir, room);
    writes = writes
      .then(async () => {
        dirty.delete(room);
        await mkdir(options.dir, { recursive: true });
        await writeFile(`${file}.tmp`, JSON.stringify({ version: LOG_FILE_VERSION, room, capped: found.capped, messages: found.own }), 'utf8');
        await rename(`${file}.tmp`, file);
      })
      .catch((cause) => options.log?.warn(`Peer lanes: the room log could not be saved: ${String(cause)}`));
  }

  return {
    async recordOwn(frame) {
      if (!frame.room || !isLoggedKind(frame.kind)) return;
      const found = await load(frame.room);
      const message = toRoomMessage(frame, true);
      found.own = found.own.filter(fresh);
      found.own.push(message);
      if (found.own.length > OWN_LOG_MAX) {
        found.own.splice(0, found.own.length - OWN_LOG_MAX);
        found.capped = true;
      }
      found.all.push(message);
      sortAll(found);
      save(frame.room, found);
    },
    recordReceived(frame) {
      if (!frame.room || !isLoggedKind(frame.kind)) return false;
      const found = state(frame.room);
      if (found.all.some((message) => message.id === frame.id)) return false;
      if (frame.replay) found.replays.set(frame.from.instance, (found.replays.get(frame.from.instance) ?? 0) + 1);
      found.all.push(toRoomMessage(frame, false));
      sortAll(found);
      return true;
    },
    async read(room, since) {
      const found = await load(room);
      const from = since ? found.all.findIndex((message) => message.id === since) + 1 : 0;
      const capped = found.capped || [...found.replays.values()].some((count) => count >= OWN_LOG_MAX) || found.all.length >= ROOM_LOG_MAX;
      return { room, messages: found.all.slice(from), capped };
    },
    async replayTo(instance, room) {
      const found = await load(room);
      let sent = 0;
      for (const message of found.own.filter(fresh)) {
        const draft: FrameDraft = {
          kind: message.kind,
          room,
          lane: message.lane,
          text: message.text,
          data: message.data,
          id: message.id,
          sentAt: message.sentAt,
          replay: true,
          ...(message.from.person ? { person: message.from.user } : {}),
        };
        if (options.network.sendTo(instance, draft)) sent += 1;
      }
      return sent;
    },
    flush: () => writes,
  };
}
