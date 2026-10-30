import { PEER_ASSIST_KINDS, PEER_DELIVERED_KINDS, type PeerFrame, type PeerKind, type PeerUnread, type RoomMember, type RoomMessage } from '@agent-lanes/contracts';
import { LANE_LABELS } from '../agent/stages/stage-rules';
import type { Logger } from '../logging';

/**
 * Delivery (AL-292, AL-299, P4, PL§3): which room messages reach which of this app's agents, as one
 * user turn per burst, behind a fixed `[Peer lanes]` prefix with the peer's words quoted as data. A
 * lane gets its turn whether its agent is running, idle or has no session; `send` wakes it or starts
 * one. Also the unread `ask`, `blocked` and `offer` counts behind the Assist bubble.
 */

export const PEER_PREFIX = '[Peer lanes]';
/** Frames this close together reach an agent as one turn. */
export const COALESCE_MS = 2_000;
const COALESCE_MAX_MS = 10_000;
/** How long a lane that just joined waits for the room's replays before it is told what was said. */
export const JOIN_SETTLE_MS = 5_000;
/** Lines of the room's log a joining agent is shown. */
const JOIN_LINES_MAX = 60;

const DELIVERED: ReadonlySet<PeerKind> = new Set(PEER_DELIVERED_KINDS);
const ASSIST: ReadonlySet<PeerKind> = new Set(PEER_ASSIST_KINDS);

function stageLabel(stage: string): string {
  return (LANE_LABELS as Record<string, string | undefined>)[stage] ?? stage;
}

function quote(text: string): string {
  return JSON.stringify(text);
}

/** Who said it: `Kyle Richards's agent on #48162 (Implementing)` or `Mitch Healy (person)`. */
export function speaker(message: Pick<RoomMessage, 'from' | 'lane'>): string {
  if (message.from.person) return `${message.from.user} (person)`;
  const lane = message.lane;
  if (!lane) return `${message.from.user}'s app`;
  const item = lane.workItemId ? `#${lane.workItemId}` : lane.title || lane.ticketId;
  return `${message.from.user}'s agent on ${item} (${stageLabel(lane.stage)})`;
}

/** One message as the line an agent reads. The peer's text is a JSON string, so it stays on the line and is never read as markup. */
export function peerLine(message: Pick<RoomMessage, 'from' | 'lane' | 'kind' | 'text' | 'data'>): string {
  if (message.kind === 'hello') {
    const lane = message.lane;
    return `${PEER_PREFIX} ${message.from.user}'s agent joined${lane?.workItemId ? ` on #${lane.workItemId}` : ''}${lane ? ` (${stageLabel(lane.stage)})` : ''}`;
  }
  const parts = [`${PEER_PREFIX} ${speaker(message)} · ${message.kind}: ${quote(message.text)}`];
  if (message.data.to) parts.push(`to ${message.data.to.user}'s agent on #${message.data.to.workItemId}`);
  if (message.data.branch) parts.push(`branch ${message.data.branch}`);
  if (message.data.files && message.data.files.length > 0) parts.push(`files ${message.data.files.join(', ')}`);
  return parts.join(' · ');
}

export interface DeliveryLane {
  ticketId: string;
  workItemId: number | null;
  /** Has a live session; only such a lane gets the join turn. */
  live: boolean;
  /** Second agents and single-step lanes read the room but get no turns. */
  receives: boolean;
}

export interface DeliveryOptions {
  /** This app's lanes in a room. */
  lanesIn: (room: string) => DeliveryLane[];
  /** The name this app's agents post under, for `answer` addressing. */
  me: () => string;
  /** Gives the lane's agent the turn: a live session takes it, and an idle or stopped agent is woken or started (AL-299). */
  send: (ticketId: string, text: string) => void;
  /** Messages for the join turn: the room's log as this app has it. */
  readLog: (room: string) => Promise<{ messages: RoomMessage[]; capped: boolean }>;
  /** The room's title for the join turn, `Feature #48000 · Job DTO`. */
  roomTitle: (room: string) => string;
  onUnread?: (unread: PeerUnread) => void;
  log?: Pick<Logger, 'warn'>;
  coalesceMs?: number;
  joinSettleMs?: number;
}

export interface Delivery {
  /** A room message: one a peer sent, or one this app sent (then `except` is the lane that posted it). */
  received(frame: PeerFrame, except?: string): void;
  /** A peer's lane joined a room this app is in. */
  memberJoined(room: string, member: RoomMember): void;
  /** One of this app's lanes joined a room with `others` already in it. */
  laneJoined(ticketId: string, room: string, others: RoomMember[]): void;
  /** A message this app sent or received, for the unread counts. */
  noted(message: RoomMessage): void;
  markSeen(room: string, upTo: string): PeerUnread;
  unread(): PeerUnread;
  unreadIn(room: string): number;
  dispose(): void;
}

interface Pending {
  lines: string[];
  timer: NodeJS.Timeout;
  firstAt: number;
}

export function createDelivery(options: DeliveryOptions): Delivery {
  const coalesceMs = options.coalesceMs ?? COALESCE_MS;
  const joinSettleMs = options.joinSettleMs ?? JOIN_SETTLE_MS;
  const pending = new Map<string, Pending>();
  const joins = new Set<NodeJS.Timeout>();
  /** Unread assist messages per room, oldest first. */
  const unseen = new Map<string, string[]>();
  const order = new Map<string, string[]>();

  function flush(ticketId: string): void {
    const batch = pending.get(ticketId);
    if (!batch) return;
    clearTimeout(batch.timer);
    pending.delete(ticketId);
    options.send(ticketId, batch.lines.join('\n'));
  }

  function queue(ticketId: string, line: string): void {
    const at = Date.now();
    const batch = pending.get(ticketId);
    if (batch) {
      clearTimeout(batch.timer);
      batch.lines.push(line);
      batch.timer = setTimeout(() => flush(ticketId), at - batch.firstAt >= COALESCE_MAX_MS ? 0 : coalesceMs);
      return;
    }
    pending.set(ticketId, { lines: [line], firstAt: at, timer: setTimeout(() => flush(ticketId), coalesceMs) });
  }

  function targets(room: string, frame?: Pick<PeerFrame, 'kind' | 'data'>): DeliveryLane[] {
    const lanes = options.lanesIn(room).filter((lane) => lane.receives);
    const to = frame?.kind === 'answer' ? frame.data.to : undefined;
    if (!to) return lanes;
    // An answer for another lane, or another person's app, is not delivered here.
    if (to.user !== options.me()) return [];
    return lanes.filter((lane) => lane.workItemId === to.workItemId);
  }

  function unread(): PeerUnread {
    const byRoom: Record<string, number> = {};
    const byTicket: Record<string, number> = {};
    let total = 0;
    for (const [room, ids] of unseen) {
      if (ids.length === 0) continue;
      byRoom[room] = ids.length;
      total += ids.length;
      for (const lane of options.lanesIn(room)) byTicket[lane.ticketId] = (byTicket[lane.ticketId] ?? 0) + ids.length;
    }
    return { total, byRoom, byTicket };
  }

  return {
    received(frame, except) {
      if (!frame.room || frame.replay || !DELIVERED.has(frame.kind) || frame.kind === 'hello') return;
      for (const lane of targets(frame.room, frame)) if (lane.ticketId !== except) queue(lane.ticketId, peerLine(frame));
    },
    memberJoined(room, member) {
      if (member.local) return;
      const line = peerLine({ kind: 'hello', from: { user: member.user, host: member.host, instance: member.instance, person: false }, lane: member.lane, text: '', data: {} });
      for (const lane of targets(room)) queue(lane.ticketId, line);
    },
    laneJoined(ticketId, room, others) {
      if (others.length === 0) return;
      const timer = setTimeout(() => {
        joins.delete(timer);
        const lane = options.lanesIn(room).find((item) => item.ticketId === ticketId);
        if (!lane?.live || !lane.receives) return;
        void options
          .readLog(room)
          .then(({ messages, capped }) => {
            const said = messages.filter((message) => !message.own).slice(-JOIN_LINES_MAX);
            const who = others.map((member) => `${member.user} (${member.lane.workItemId ? `#${member.lane.workItemId}` : member.lane.title}, ${stageLabel(member.lane.stage)})`).join(', ');
            const lines = [
              `${PEER_PREFIX} You joined room ${options.roomTitle(room)} with ${who}.`,
              said.length > 0
                ? `${PEER_PREFIX} Said so far (${said.length} line${said.length === 1 ? '' : 's'}${capped || messages.length > said.length ? ', older ones left out' : ''}):`
                : `${PEER_PREFIX} Nothing has been said in the room yet.`,
              ...said.map(peerLine),
              `${PEER_PREFIX} Post \`ask\` with post_to_room: the status, and where you can help.`,
            ];
            options.send(ticketId, lines.join('\n'));
          })
          .catch((cause) => options.log?.warn(`Peer lanes: the join turn for ${ticketId} failed: ${String(cause)}`));
      }, joinSettleMs);
      joins.add(timer);
    },
    noted(message) {
      if (!message.room) return;
      const ids = order.get(message.room) ?? [];
      ids.push(message.id);
      order.set(message.room, ids.slice(-2_000));
      if (message.own || message.replay || !ASSIST.has(message.kind)) {
        options.onUnread?.(unread());
        return;
      }
      unseen.set(message.room, [...(unseen.get(message.room) ?? []), message.id]);
      options.onUnread?.(unread());
    },
    markSeen(room, upTo) {
      const ids = order.get(room) ?? [];
      const at = ids.indexOf(upTo);
      const seen = new Set(at === -1 ? [] : ids.slice(0, at + 1));
      unseen.set(room, (unseen.get(room) ?? []).filter((id) => !seen.has(id)));
      const counts = unread();
      options.onUnread?.(counts);
      return counts;
    },
    unread,
    unreadIn: (room) => unseen.get(room)?.length ?? 0,
    dispose() {
      for (const batch of pending.values()) clearTimeout(batch.timer);
      pending.clear();
      for (const timer of joins) clearTimeout(timer);
      joins.clear();
    },
  };
}
