import { z } from 'zod';
import type { InvokeContract } from '../contract';
import { EventEnvelopeSchema, TicketIdSchema } from '../events';
import { WorkItemIdSchema } from './ado.ids';
import type { PEERS_EVENT_CHANNELS, PEERS_INVOKE_CHANNELS } from './peers.names';

// ── Frames (PL§3) ────────────────────────────────────────────────────────────────────────────────
//
// One JSON object per WebSocket message between two Agent Lanes apps on the office LAN. `sig` is an
// HMAC-SHA256 with the team secret over the canonical JSON of every other field; the receiver checks
// it before this schema reads anything (`src/main/peers/signer.ts`).

export const PEER_PROTOCOL_VERSION = 1;
export const DEFAULT_PEER_PORT = 47811;
export const PEER_TEXT_MAX = 2_000;
/** The most files one frame lists. */
export const PEER_FILES_MAX = 500;

export const PEER_KINDS = ['hello', 'status', 'touched', 'changed', 'blocked', 'done', 'ask', 'answer', 'offer', 'bye'] as const;
export const PeerKindSchema = z.enum(PEER_KINDS);
export type PeerKind = z.infer<typeof PeerKindSchema>;

/** Kinds that reach the other lanes' Claudes as a user turn (PL§8); `status`, `touched` and `bye` drive the board only. */
export const PEER_DELIVERED_KINDS = ['hello', 'changed', 'blocked', 'done', 'ask', 'answer', 'offer'] as const satisfies readonly PeerKind[];
/** Kinds that raise the Assist bubble until the user has looked (P8). */
export const PEER_ASSIST_KINDS = ['ask', 'blocked', 'offer'] as const satisfies readonly PeerKind[];
/** Kinds a Claude or a person posts into a room; the app sends the rest itself. */
export const PEER_POST_KINDS = ['changed', 'blocked', 'done', 'ask', 'answer', 'offer'] as const satisfies readonly PeerKind[];
export const PeerPostKindSchema = z.enum(PEER_POST_KINDS);
export type PeerPostKind = z.infer<typeof PeerPostKindSchema>;
const QUIET_KINDS: ReadonlySet<PeerKind> = new Set(['status', 'touched', 'bye']);

export function isPeerPostKind(kind: PeerKind): kind is PeerPostKind {
  return (PEER_POST_KINDS as readonly PeerKind[]).includes(kind);
}

/** `<organisation URL>#<parent work item id>`, lower case, so rooms never cross organisations (P2). */
export const PeerRoomIdSchema = z.string().min(3).max(2_100).regex(/^\S+#\d+$/, 'Not a room id');
export type PeerRoomId = z.infer<typeof PeerRoomIdSchema>;

export function peerRoomId(orgUrl: string, parentId: number): PeerRoomId {
  return `${orgUrl.trim().replace(/\/+$/, '').toLowerCase()}#${parentId}`;
}

/** A peer as listed in Connections: a host name or IP, with an optional `:port` (`[v6]:port` for IPv6). */
export interface PeerAddress {
  host: string;
  port: number;
}

export function parsePeerAddress(address: string): PeerAddress | null {
  const text = address.trim();
  const bracketed = /^\[([0-9a-fA-F:.]+)\](?::(\d{1,5}))?$/.exec(text);
  const plain = /^([A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(text);
  const bareV6 = /^[0-9a-fA-F]*:[0-9a-fA-F:.]*:[0-9a-fA-F:.]*$/.test(text) ? text : null;
  const host = bracketed?.[1] ?? plain?.[1] ?? bareV6;
  if (!host || host.startsWith('.') || host.startsWith('-')) return null;
  const portText = bracketed?.[2] ?? plain?.[2];
  const port = portText === undefined ? DEFAULT_PEER_PORT : Number(portText);
  return port >= 1 && port <= 65_535 ? { host, port } : null;
}

/** The most peers one app lists. */
export const PEER_LIST_MAX = 50;

/** One row of the Peers tab's peer list (AL-289). */
export const PeerAddressTextSchema = z
  .string()
  .trim()
  .min(1, 'Enter a computer name or IP address')
  .max(300)
  .refine((address) => parsePeerAddress(address) !== null, `Use a computer name or IP address, with :port when it isn't ${DEFAULT_PEER_PORT}`);

/** What Test found at one listed peer (AL-289): it answered with the same team secret, could not be reached, or signs with another secret. */
export const PEER_PROBE_OUTCOMES = ['answered', 'unreachable', 'rejected'] as const;
export const PeerProbeSchema = z.object({
  address: z.string().min(1).max(300),
  outcome: z.enum(PEER_PROBE_OUTCOMES),
  user: z.string().min(1).max(200).nullable(),
  host: z.string().min(1).max(255).nullable(),
  message: z.string().nullable(),
});
export type PeerProbe = z.infer<typeof PeerProbeSchema>;

/** Worktree-relative, forward slashes. */
export const PeerPathSchema = z.string().min(1).max(1_024);
const UserNameSchema = z.string().min(1).max(200);
const BranchSchema = z.string().min(1).max(255);

export const PeerFromSchema = z.object({
  /** The identity from the ADO token test (TB§6), or the person who posted. */
  user: UserNameSchema,
  host: z.string().min(1).max(255),
  /** Made on the app's first run and kept in its data folder. */
  instance: z.uuid(),
  /** Posted by a person from the Room tab, not by an agent. */
  person: z.boolean(),
});
export type PeerFrom = z.infer<typeof PeerFromSchema>;

export const PeerLaneSchema = z.object({
  ticketId: TicketIdSchema,
  workItemId: WorkItemIdSchema.nullable(),
  title: z.string().max(1_000),
  /** The sender's lane (`implementing`, `qa-only`, …); a string so a newer app's lanes still read. */
  stage: z.string().min(1).max(40),
  branch: BranchSchema,
  parentId: WorkItemIdSchema.nullable(),
});
export type PeerLane = z.infer<typeof PeerLaneSchema>;

/** Who an `answer` is for: the lane on that work item, on that user's app. */
export const PeerAddresseeSchema = z.object({ user: UserNameSchema, workItemId: WorkItemIdSchema });
export type PeerAddressee = z.infer<typeof PeerAddresseeSchema>;

export const PeerDataSchema = z.object({
  files: z.array(PeerPathSchema).max(PEER_FILES_MAX).optional(),
  branch: BranchSchema.optional(),
  to: PeerAddresseeSchema.optional(),
  /** The sender's listening port, in the hello that opens a connection, so the other app knows which listed peer it is. */
  port: z.int().min(1).max(65_535).optional(),
});
export type PeerData = z.infer<typeof PeerDataSchema>;

const PeerFrameBaseSchema = z.object({
  v: z.literal(PEER_PROTOCOL_VERSION),
  /** Every app drops an id it has seen. */
  id: z.uuid(),
  room: PeerRoomIdSchema.nullable(),
  kind: PeerKindSchema,
  from: PeerFromSchema,
  lane: PeerLaneSchema.nullable(),
  text: z.string().max(PEER_TEXT_MAX),
  data: PeerDataSchema,
  sentAt: z.iso.datetime(),
  /** Sent again to a late joiner (P7). */
  replay: z.boolean(),
});

function checkFrame(frame: z.infer<typeof PeerFrameBaseSchema>, ctx: z.core.$RefinementCtx): void {
  if (QUIET_KINDS.has(frame.kind) && frame.text !== '') ctx.addIssue({ code: 'custom', path: ['text'], message: `A ${frame.kind} frame has no text` });
  if (isPeerPostKind(frame.kind)) {
    if (frame.text.trim() === '') ctx.addIssue({ code: 'custom', path: ['text'], message: `A ${frame.kind} frame needs text` });
    if (frame.room === null) ctx.addIssue({ code: 'custom', path: ['room'], message: `A ${frame.kind} frame needs a room` });
  }
}

/** A frame before it is signed. */
export const UnsignedPeerFrameSchema = PeerFrameBaseSchema.superRefine(checkFrame);
export type UnsignedPeerFrame = z.infer<typeof UnsignedPeerFrameSchema>;

export const PeerFrameSchema = PeerFrameBaseSchema.extend({
  /** HMAC-SHA256, hex, over the canonical JSON of every other field. */
  sig: z.string().regex(/^[0-9a-f]{64}$/, 'Not a signature'),
}).superRefine(checkFrame);
export type PeerFrame = z.infer<typeof PeerFrameSchema>;

// ── What the renderer sees (PL§4) ────────────────────────────────────────────────────────────────

const EpochMsSchema = z.int().nonnegative();
const CountSchema = z.int().nonnegative();

/** `connecting` until the first signed `hello`; `rejected`: its frames fail the signature (a different team secret). */
export const PEER_LINK_STATES = ['connecting', 'online', 'unreachable', 'rejected'] as const;
export const PeerLinkStateSchema = z.enum(PEER_LINK_STATES);
export type PeerLinkState = z.infer<typeof PeerLinkStateSchema>;

/** One peer listed in Connections. */
export const PeerLinkSchema = z.object({
  /** As listed: `KYLE-PC`, `10.0.0.12`, `localhost:47812`. */
  address: z.string().min(1).max(300),
  state: PeerLinkStateSchema,
  /** Who answered, from its signed `hello`; null until then. */
  user: UserNameSchema.nullable(),
  host: z.string().min(1).max(255).nullable(),
  instance: z.uuid().nullable(),
  lastSeenAt: EpochMsSchema.nullable(),
  /** Frames from it dropped for a bad signature since the app started. */
  rejectedFrames: CountSchema,
  /** Why it is unreachable or rejected, in words; null otherwise. */
  message: z.string().nullable(),
});
export type PeerLink = z.infer<typeof PeerLinkSchema>;

/** `off`: no Peers connection. `failed`: the port could not be opened; dialling out still works. */
export const PEER_LISTENER_STATES = ['off', 'listening', 'failed'] as const;
export const PeerListenerSchema = z.object({
  state: z.enum(PEER_LISTENER_STATES),
  port: z.int().min(1).max(65_535).nullable(),
  message: z.string().nullable(),
});
export type PeerListener = z.infer<typeof PeerListenerSchema>;

export const PeerNetworkStatusSchema = z.object({
  listener: PeerListenerSchema,
  peers: z.array(PeerLinkSchema).max(200),
  /** Connections closed at accept (not a private address, not a listed host) or for breaking a cap (PL§7). */
  refusedConnections: CountSchema,
});
export type PeerNetworkStatus = z.infer<typeof PeerNetworkStatusSchema>;

/** One lane in a room, on this app or a peer's (P3). */
export const RoomMemberSchema = z.object({
  instance: z.uuid(),
  user: UserNameSchema,
  host: z.string().min(1).max(255),
  lane: PeerLaneSchema,
  touched: z.array(PeerPathSchema).max(PEER_FILES_MAX),
  lastSeenAt: EpochMsSchema,
  /** On this computer. */
  local: z.boolean(),
  /** Its app is still connected; false until it expires shows "last seen" (PL§6). */
  reachable: z.boolean(),
});
export type RoomMember = z.infer<typeof RoomMemberSchema>;

export const PeerRoomSchema = z.object({
  id: PeerRoomIdSchema,
  parentId: WorkItemIdSchema,
  /** `Feature` or `Epic`, and its title, from this app's ADO read. */
  parentType: z.string().max(100),
  parentTitle: z.string().max(1_000),
  members: z.array(RoomMemberSchema).max(200),
  /** `ask`, `blocked` and `offer` messages not looked at yet (P8). */
  unread: CountSchema,
});
export type PeerRoom = z.infer<typeof PeerRoomSchema>;

export const PeerRoomsSchema = z.object({
  /** Rooms this app's lanes are in. */
  rooms: z.array(PeerRoomSchema).max(200),
  /** Peers' lanes in rooms this app is not in, or in none: the team board's live tags (PL§2). */
  others: z.array(RoomMemberSchema).max(500),
});
export type PeerRooms = z.infer<typeof PeerRoomsSchema>;

/** A frame as the room log shows it: never the signature. */
export const RoomMessageSchema = PeerFrameBaseSchema.extend({
  /** Sent by this app. */
  own: z.boolean(),
});
export type RoomMessage = z.infer<typeof RoomMessageSchema>;

export const RoomLogRequestSchema = z.strictObject({
  room: PeerRoomIdSchema,
  /** Only messages after this one. */
  since: z.uuid().optional(),
});
export const RoomLogSchema = z.object({
  room: PeerRoomIdSchema,
  /** Own, replayed and live messages, oldest first. */
  messages: z.array(RoomMessageSchema).max(1_000),
  /** Older messages were dropped at the cap. */
  capped: z.boolean(),
});
export type RoomLog = z.infer<typeof RoomLogSchema>;

/** A person's post from the Room tab; it goes out as `from.person: true`, not as an agent. */
export const PostToRoomRequestSchema = z.strictObject({
  room: PeerRoomIdSchema,
  kind: PeerPostKindSchema,
  text: z.string().trim().min(1).max(PEER_TEXT_MAX),
  to: PeerAddresseeSchema.optional(),
});
export type PostToRoomRequest = z.infer<typeof PostToRoomRequestSchema>;

/** Unread `ask`, `blocked` and `offer` messages behind the Assist bubble (P8). */
export const PeerUnreadSchema = z.object({
  total: CountSchema,
  byRoom: z.record(PeerRoomIdSchema, CountSchema),
  /** Local lanes in a room with unread messages: the lane header's bubble. */
  byTicket: z.record(TicketIdSchema, CountSchema),
});
export type PeerUnread = z.infer<typeof PeerUnreadSchema>;

export const MarkSeenRequestSchema = z.strictObject({ room: PeerRoomIdSchema, upTo: z.uuid() });

export const PEER_PRESENCE_CHANGES = ['joined', 'updated', 'left', 'expired'] as const;
export const PeerPresenceEventSchema = EventEnvelopeSchema.extend({
  room: PeerRoomIdSchema.nullable(),
  change: z.enum(PEER_PRESENCE_CHANGES),
  member: RoomMemberSchema,
});
export type PeerPresenceEvent = z.infer<typeof PeerPresenceEventSchema>;

export const PeerMessageEventSchema = EventEnvelopeSchema.extend({
  message: RoomMessageSchema,
  unread: PeerUnreadSchema,
});
export type PeerMessageEvent = z.infer<typeof PeerMessageEventSchema>;

export const PeerStatusEventSchema = EventEnvelopeSchema.extend(PeerNetworkStatusSchema.shape);
export type PeerStatusEvent = z.infer<typeof PeerStatusEventSchema>;

export const peersInvokeContracts = {
  'peers:list': { request: z.undefined(), response: PeerNetworkStatusSchema },
  'peers:rooms': { request: z.undefined(), response: PeerRoomsSchema },
} as const satisfies Record<(typeof PEERS_INVOKE_CHANNELS)[number], InvokeContract>;

export const peersEventContracts = {
  'peers:status': PeerStatusEventSchema,
  'peers:presence': PeerPresenceEventSchema,
} as const satisfies Record<(typeof PEERS_EVENT_CHANNELS)[number], z.ZodType>;
