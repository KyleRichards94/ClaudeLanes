import { err, ok, type PostToRoomRequest, type Result, type RoomMember, type RoomMessage, type TicketRecord } from '@agent-lanes/contracts';
import type { PeerPostInput, PeerToolBackend } from '../agent/stages/peer-tools';
import type { GitService } from '../git';
import type { Emit } from '../ipc/emit';
import type { TicketRecordStore } from '../tickets';
import type { Delivery } from './delivery';
import { peerLine } from './delivery';
import type { FrameDraft, PeerNetwork } from './network';
import { laneOf } from './presence';
import { toRoomMessage, type RoomLogStore } from './room-log';
import type { Rooms } from './rooms';

/**
 * Posting into a room (AL-292, PL§3): an agent's `post_to_room` and a person's post from the Room tab.
 * A post goes to every peer, into this app's own log, and to this app's other lanes in the room.
 */

/** One post per lane in this long, except `answer`. */
export const POST_EVERY_MS = 20_000;
/** Messages `read_room` returns at most. */
export const READ_ROOM_MAX = 200;

export interface PeerPostingOptions {
  network: Pick<PeerNetwork, 'broadcast' | 'status' | 'identity'>;
  rooms: Pick<Rooms, 'roomFor' | 'ensureRoom' | 'members' | 'localIn'>;
  roomLog: Pick<RoomLogStore, 'recordOwn' | 'read'>;
  delivery: Pick<Delivery, 'received' | 'noted' | 'unread'>;
  tickets: Pick<TicketRecordStore, 'get'>;
  git: Pick<GitService, 'status'>;
  emit?: Emit;
  now?: () => number;
}

export interface PeerPosting extends PeerToolBackend {
  personPost(request: PostToRoomRequest): Promise<Result<RoomMessage>>;
  agentPost(ticketId: string, input: PeerPostInput): Promise<Result<RoomMessage>>;
}

export function roomTitle(room: { parentType: string; parentId: number; parentTitle: string }): string {
  return `${room.parentType || 'Feature'} #${room.parentId}${room.parentTitle ? ` · ${room.parentTitle}` : ''}`;
}

function minutesAgo(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000);
  return minutes < 1 ? 'just now' : `${minutes} min ago`;
}

/** `list_peers`'s answer: everyone in the room, then the files this lane shares with others. */
export function describePeers(title: string, self: string, members: readonly RoomMember[], now: number): string {
  const mine = members.find((member) => member.local && member.lane.ticketId === self);
  const lines = [`Room ${title}`];
  for (const member of members) {
    const who = member.local ? (member.lane.ticketId === self ? 'You' : `${member.user} (this computer)`) : `${member.user} on ${member.host}`;
    const item = member.lane.workItemId ? `#${member.lane.workItemId}` : member.lane.title;
    const parts = [`- ${who}: ${item} (${member.lane.stage}) on ${member.lane.branch}`];
    if (member.touched.length > 0) parts.push(`touched ${member.touched.join(', ')}`);
    if (!member.local) parts.push(member.reachable ? `last seen ${minutesAgo(member.lastSeenAt, now)}` : `not reachable since ${minutesAgo(member.lastSeenAt, now)}`);
    lines.push(parts.join(' · '));
  }
  const overlap = mine
    ? members
        .filter((member) => member !== mine)
        .flatMap((member) => member.touched.filter((path) => mine.touched.includes(path)).map((path) => `${path} (${member.local ? member.user : `${member.user} on ${member.host}`})`))
    : [];
  lines.push(overlap.length > 0 ? `Overlap: ${overlap.join(', ')}` : 'Overlap: none');
  return lines.join('\n');
}

export function createPeerPosting(options: PeerPostingOptions): PeerPosting {
  const now = options.now ?? Date.now;
  const lastPost = new Map<string, number>();

  function off(): boolean {
    return options.network.status().listener.state === 'off';
  }

  async function send(draft: FrameDraft, except?: string): Promise<Result<RoomMessage>> {
    const frame = options.network.broadcast(draft);
    if (!frame) return err('INTERNAL', 'The message could not be sent.');
    const message = toRoomMessage(frame, true);
    await options.roomLog.recordOwn(frame);
    options.delivery.received(frame, except);
    options.delivery.noted(message);
    options.emit?.('peers:message', { message, unread: options.delivery.unread() });
    return ok(message);
  }

  /** The lead's record for a second agent, the ticket's own otherwise. */
  async function leadOf(ticketId: string): Promise<TicketRecord | undefined> {
    const record = await options.tickets.get(ticketId);
    return record?.companion ? options.tickets.get(record.companion.of) : record;
  }

  async function roomOf(ticketId: string): Promise<Result<{ record: TicketRecord; room: NonNullable<TicketRecord['room']> }>> {
    if (off()) return err('VALIDATION', 'Peer lanes is off: there is no Peers connection in Connections.');
    const record = await leadOf(ticketId);
    if (!record) return err('VALIDATION', `There is no ticket ${ticketId}.`);
    const room = record.room === undefined ? await options.rooms.ensureRoom(record.id) : record.room;
    if (room) return ok({ record, room });
    if (!record.ado) return err('VALIDATION', 'No room: this ticket has no work item.');
    if (record.room === null) return err('VALIDATION', `No room: #${record.ado.workItemId} has no parent Feature or Epic.`);
    return err('VALIDATION', `No room yet: the parent of #${record.ado.workItemId} could not be read from Azure DevOps. Try again in a minute.`);
  }

  /** `changed` waits for the push (P6). */
  async function pushed(record: TicketRecord): Promise<Result<void>> {
    let branch;
    try {
      branch = (await options.git.status(record.worktreePath)).branch;
    } catch {
      return err('VALIDATION', `The ticket branch ${record.branch} could not be checked; push it, then post again.`);
    }
    if (!branch?.upstream) return err('VALIDATION', `Push ${record.branch} first: it has no upstream yet.`);
    if (branch.ahead === null) return err('VALIDATION', `Push ${record.branch} first: its upstream is gone.`);
    if (branch.ahead > 0) return err('VALIDATION', `Push ${record.branch} first: ${branch.ahead} commit${branch.ahead === 1 ? ' is' : 's are'} not on the remote yet.`);
    return ok(undefined);
  }

  async function agentPost(ticketId: string, input: PeerPostInput): Promise<Result<RoomMessage>> {
    const found = await roomOf(ticketId);
    if (!found.ok) return found;
    const { record, room } = found.data;
    const last = lastPost.get(record.id);
    if (input.kind !== 'answer' && last !== undefined && now() - last < POST_EVERY_MS) {
      return err('VALIDATION', `One post every 20 s per lane: wait ${Math.ceil((POST_EVERY_MS - (now() - last)) / 1_000)} s, then post again.`);
    }
    if (input.kind === 'changed') {
      const ready = await pushed(record);
      if (!ready.ok) return ready;
    }
    const data = {
      ...(input.files && input.files.length > 0 ? { files: input.files } : {}),
      ...(input.kind === 'changed' ? { branch: record.branch } : {}),
      ...(input.to ? { to: input.to } : {}),
    };
    const sent = await send({ kind: input.kind, room: room.id, lane: laneOf(record), text: input.text, data }, record.id);
    if (sent.ok && input.kind !== 'answer') lastPost.set(record.id, now());
    return sent;
  }

  return {
    agentPost,
    async personPost(request) {
      if (off()) return err('VALIDATION', 'Peer lanes is off: there is no Peers connection in Connections.');
      if (options.rooms.localIn(request.room).length === 0) return err('VALIDATION', 'None of your lanes is in that room.');
      return send({ kind: request.kind, room: request.room, lane: null, text: request.text, data: request.to ? { to: request.to } : {}, person: options.network.identity().user });
    },
    async post(ticketId, input) {
      const sent = await agentPost(ticketId, input);
      return sent.ok ? ok(`Posted ${input.kind} to the room.`) : sent;
    },
    async listPeers(ticketId) {
      const found = await roomOf(ticketId);
      if (!found.ok) return found;
      return ok(describePeers(roomTitle(found.data.room), found.data.record.id, options.rooms.members(found.data.room.id), now()));
    },
    async readRoom(ticketId, since) {
      const found = await roomOf(ticketId);
      if (!found.ok) return found;
      const log = await options.roomLog.read(found.data.room.id, since);
      const messages = log.messages.slice(-READ_ROOM_MAX);
      if (messages.length === 0) return ok(`Nothing has been said in room ${roomTitle(found.data.room)} yet.`);
      const older = log.capped || log.messages.length > messages.length ? ['Older messages were left out.'] : [];
      return ok([...older, ...messages.map((message) => `${message.sentAt.slice(11, 16)} UTC · id ${message.id} · ${peerLine(message)}`)].join('\n'));
    },
    async room(ticketId) {
      if (off()) return null;
      const found = await roomOf(ticketId);
      if (!found.ok) return null;
      return { title: roomTitle(found.data.room), others: options.rooms.members(found.data.room.id).filter((member) => !member.local).length };
    },
  };
}
