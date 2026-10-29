import { randomUUID } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  PEER_PROTOCOL_VERSION,
  UnsignedPeerFrameSchema,
  parsePeerAddress,
  type PeerData,
  type PeerFrame,
  type PeerKind,
  type PeerLane,
  type PeerLinkState,
  type PeerListener,
  type PeerNetworkStatus,
  type PeerRoomId,
} from '@agent-lanes/contracts';
import type { Emit } from '../ipc/emit';
import type { Logger } from '../logging';
import { isLoopbackHost, isLoopbackIp, isPrivateIp, plainIp } from './addresses';
import { openFrame, signFrame } from './signer';

/**
 * The peer network (AL-288, PL§4): a WebSocket listener for the peers listed in Connections and one
 * outbound connection to each. Frames are signed with the team secret; anything that fails the
 * signature is dropped and counted. Between two apps only one connection stays open: the one the
 * lower instance id started.
 */

export const PEER_FRAME_MAX_BYTES = 64 * 1024;
export const PEER_FRAMES_PER_SECOND = 20;
/** This app's sending rate to one peer: `PEER_SEND_BURST` at once, then this many a second; at most 18 in any second, under the peer's cap. */
export const PEER_SEND_PER_SECOND = 14;
export const PEER_SEND_BURST = 4;
export const PEER_HEARTBEAT_MS = 30_000;
export const PEER_EXPIRY_MS = 90_000;
const SEEN_IDS_MAX = 10_000;
const RESOLVE_AGAIN_MS = 10_000;
const HANDSHAKE_TIMEOUT_MS = 5_000;

/** WebSocket close codes this app uses. */
export const CLOSE_DUPLICATE = 4001;
export const CLOSE_SELF = 4002;
export const CLOSE_RATE = 4008;
export const CLOSE_SPOOF = 4003;

export interface PeerConfig {
  /** 0 picks a free port (tests). */
  port: number;
  secret: string;
  /** As listed in Connections: `KYLE-PC`, `10.0.0.12:47812`, `localhost:47812`. */
  peers: readonly string[];
}

export interface PeerIdentity {
  user: string;
  host: string;
  instance: string;
}

/** What the app gives `broadcast` and `sendTo`; the network adds the version, id, sender and time. */
export interface FrameDraft {
  kind: PeerKind;
  room: PeerRoomId | null;
  lane: PeerLane | null;
  text?: string;
  data?: PeerData;
  /** A person's post from the Room tab: their name, sent as `from.person`. */
  person?: string;
  /** Sending one of this app's earlier frames again (a replay): its id and time. */
  id?: string;
  sentAt?: string;
  replay?: boolean;
}

export type PeerGoneReason = 'bye' | 'expired' | 'closed';
export type PeerEvent = { instance: string; change: 'online' } | { instance: string; change: 'gone'; reason: PeerGoneReason };

export interface PeerNetwork {
  /** Starts, restarts on a new config, or stops with null. Resolves once the listener is up or has failed. */
  configure(config: PeerConfig | null): Promise<void>;
  /** Signs a frame and sends it to every connected peer; null when the network is off or the frame is not valid. */
  broadcast(draft: FrameDraft): PeerFrame | null;
  /** Signs a frame and sends it to one peer; false when that peer is not connected. */
  sendTo(instance: string, draft: FrameDraft): boolean;
  status(): PeerNetworkStatus;
  identity(): PeerIdentity;
  /** Instances with an open connection. */
  online(): string[];
  /** Open connections, identified or not. */
  connections(): Array<{ direction: 'in' | 'out'; instance: string | null }>;
  /** Room and lane frames that passed the signature, the schema and the duplicate check. */
  onFrame(listener: (frame: PeerFrame) => void): () => void;
  onPeer(listener: (event: PeerEvent) => void): () => void;
  /** Says `bye` and closes everything. */
  dispose(): Promise<void>;
}

export interface PeerNetworkOptions {
  identity: () => PeerIdentity;
  emit?: Emit;
  log?: Pick<Logger, 'info' | 'warn'>;
  now?: () => number;
  heartbeatMs?: number;
  expiryMs?: number;
  backoffMs?: { min: number; max: number };
  resolve?: (host: string) => Promise<string[]>;
  /** Where to listen instead of the address the peer list implies (tests that must not open a LAN port). */
  bindHost?: string;
}

interface Link {
  readonly address: string;
  readonly host: string;
  readonly port: number;
  ips: Set<string>;
  state: PeerLinkState;
  message: string | null;
  instance: string | null;
  user: string | null;
  hostName: string | null;
  lastSeenAt: number | null;
  rejectedFrames: number;
  out: Conn | null;
  timer: NodeJS.Timeout | null;
  attempt: number;
  /** It answered as this app: never dialled again. */
  self: boolean;
}

interface Conn {
  readonly ws: WebSocket;
  readonly direction: 'in' | 'out';
  readonly remoteIp: string;
  link: Link | null;
  instance: string | null;
  lastActivity: number;
  frameTimes: number[];
  goneReason: PeerGoneReason | null;
  duplicate: boolean;
  outbox: string[];
  tokens: number;
  refilledAt: number;
  pumpTimer: NodeJS.Timeout | null;
}

interface Peer {
  user: string;
  host: string;
  conns: Set<Conn>;
}

async function resolveHost(host: string): Promise<string[]> {
  if (host.toLowerCase() === 'localhost') return ['127.0.0.1', '::1'];
  const found = await lookup(host, { all: true });
  return found.map((entry) => plainIp(entry.address));
}

/**
 * Who may connect (PL§7), from the address alone: loopback only while a loopback peer is listed;
 * otherwise a private address that a listed peer resolves to. `unknown`: private but not one of the
 * listed peers' addresses as last resolved, so they are resolved again before it is refused.
 */
export function acceptsAddress(remote: string, links: ReadonlyArray<{ host: string; ips: ReadonlySet<string> }>): 'accept' | 'refuse' | 'unknown' {
  const ip = plainIp(remote);
  if (isLoopbackIp(ip)) return links.some((link) => isLoopbackHost(link.host)) ? 'accept' : 'refuse';
  if (!isPrivateIp(ip)) return 'refuse';
  return links.some((link) => link.ips.has(ip)) ? 'accept' : 'unknown';
}

function isAppLevel(frame: PeerFrame): boolean {
  return frame.room === null && frame.lane === null;
}

export function createPeerNetwork(options: PeerNetworkOptions): PeerNetwork {
  const now = options.now ?? Date.now;
  const heartbeatMs = options.heartbeatMs ?? PEER_HEARTBEAT_MS;
  const expiryMs = options.expiryMs ?? PEER_EXPIRY_MS;
  const backoff = options.backoffMs ?? { min: 1_000, max: 30_000 };
  const resolve = options.resolve ?? resolveHost;
  const frameListeners = new Set<(frame: PeerFrame) => void>();
  const peerListeners = new Set<(event: PeerEvent) => void>();
  const seen = new Set<string>();
  const peers = new Map<string, Peer>();
  const conns = new Set<Conn>();
  let links: Link[] = [];
  let config: PeerConfig | null = null;
  let server: WebSocketServer | null = null;
  let listener: PeerListener = { state: 'off', port: null, message: null };
  let refused = 0;
  let resolvedAt = 0;
  const intervals: NodeJS.Timeout[] = [];
  let generation = 0;

  function emitStatus(): void {
    options.emit?.('peers:status', status());
  }

  function status(): PeerNetworkStatus {
    return {
      listener: { ...listener },
      peers: links.map((link) => ({
        address: link.address,
        state: link.state,
        user: link.user,
        host: link.hostName,
        instance: link.instance,
        lastSeenAt: link.lastSeenAt,
        rejectedFrames: link.rejectedFrames,
        message: link.message,
      })),
      refusedConnections: refused,
    };
  }

  function remember(id: string): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    if (seen.size > SEEN_IDS_MAX) seen.delete(seen.values().next().value as string);
    return true;
  }

  function build(draft: FrameDraft): PeerFrame | null {
    if (!config) return null;
    const me = options.identity();
    const parsed = UnsignedPeerFrameSchema.safeParse({
      v: PEER_PROTOCOL_VERSION,
      id: draft.id ?? randomUUID(),
      room: draft.room,
      kind: draft.kind,
      from: { user: draft.person ?? me.user, host: me.host, instance: me.instance, person: draft.person !== undefined },
      lane: draft.lane,
      text: draft.text ?? '',
      data: draft.data ?? {},
      sentAt: draft.sentAt ?? new Date(now()).toISOString(),
      replay: draft.replay ?? false,
    });
    if (!parsed.success) {
      options.log?.warn(`Peer lanes: a ${draft.kind} frame was not sent: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return null;
    }
    return signFrame(parsed.data, config.secret);
  }

  /** Queues a frame behind the pacing in `pump`, so a burst (a replay, a reconnect) stays under the other side's cap. */
  function write(conn: Conn, frame: PeerFrame): void {
    conn.outbox.push(JSON.stringify(frame));
    pump(conn);
  }

  function pump(conn: Conn): void {
    if (conn.pumpTimer) return;
    while (conn.outbox.length > 0 && conn.ws.readyState === WebSocket.OPEN) {
      // A token bucket: a few at once, then an even stream, so no second ever holds more than the other side's cap.
      const at = now();
      conn.tokens = Math.min(PEER_SEND_BURST, conn.tokens + ((at - conn.refilledAt) * PEER_SEND_PER_SECOND) / 1_000);
      conn.refilledAt = at;
      if (conn.tokens < 1) {
        conn.pumpTimer = setTimeout(() => {
          conn.pumpTimer = null;
          pump(conn);
        }, Math.ceil(((1 - conn.tokens) * 1_000) / PEER_SEND_PER_SECOND));
        return;
      }
      conn.tokens -= 1;
      conn.ws.send(conn.outbox.shift() as string);
    }
  }

  function hello(conn: Conn): void {
    const frame = build({ kind: 'hello', room: null, lane: null, data: listener.port ? { port: listener.port } : {} });
    if (frame) write(conn, frame);
  }

  function refreshLink(link: Link): void {
    const peer = link.instance ? peers.get(link.instance) : undefined;
    if (peer && peer.conns.size > 0) {
      link.state = 'online';
      link.message = null;
    }
  }

  function linkFor(conn: Conn, frame: PeerFrame): Link | null {
    if (conn.link) return conn.link;
    const byIp = links.filter((link) => link.ips.has(conn.remoteIp) || (isLoopbackIp(conn.remoteIp) && isLoopbackHost(link.host)));
    const port = frame.data.port;
    return byIp.find((link) => link.port === port) ?? (byIp.length === 1 ? (byIp[0] ?? null) : null);
  }

  function identify(conn: Conn, frame: PeerFrame): boolean {
    const me = options.identity();
    if (frame.from.instance === me.instance) {
      if (conn.link) {
        conn.link.self = true;
        conn.link.state = 'unreachable';
        conn.link.message = 'This address is this app.';
      }
      conn.ws.close(CLOSE_SELF, 'self');
      return false;
    }
    conn.instance = frame.from.instance;
    conn.link = linkFor(conn, frame);
    if (conn.link) {
      conn.link.instance = frame.from.instance;
      conn.link.user = frame.from.user;
      conn.link.hostName = frame.from.host;
    }
    const peer = peers.get(conn.instance) ?? { user: frame.from.user, host: frame.from.host, conns: new Set<Conn>() };
    const fresh = peer.conns.size === 0;
    const initiator = (c: Conn) => (c.direction === 'out' ? me.instance : (c.instance ?? ''));
    for (const other of peer.conns) {
      // Both apps keep the connection the lower instance id started; the same rule on both ends picks the same one.
      const keepOther = initiator(other) < initiator(conn) || (initiator(other) === initiator(conn) && other.direction === conn.direction);
      const [winner, loser] = keepOther ? [other, conn] : [conn, other];
      loser.duplicate = true;
      // What the closing connection had not sent yet goes out on the one that stays.
      winner.outbox.unshift(...loser.outbox.splice(0));
      loser.ws.close(CLOSE_DUPLICATE, 'duplicate');
      pump(winner);
      if (loser === conn) return false;
      peer.conns.delete(other);
    }
    peer.conns.add(conn);
    peers.set(conn.instance, peer);
    if (conn.link) refreshLink(conn.link);
    if (fresh) for (const listen of peerListeners) listen({ instance: conn.instance, change: 'online' });
    emitStatus();
    return true;
  }

  function onMessage(conn: Conn, data: RawData): void {
    // Frames still arriving on a connection closed as a duplicate are read too; the id check drops repeats.
    const at = now();
    conn.lastActivity = at;
    conn.frameTimes = conn.frameTimes.filter((time) => at - time < 1_000);
    conn.frameTimes.push(at);
    if (conn.frameTimes.length > PEER_FRAMES_PER_SECOND) {
      refused += 1;
      options.log?.warn(`Peer lanes: closed a connection from ${conn.remoteIp} for sending more than ${PEER_FRAMES_PER_SECOND} frames a second`);
      conn.ws.close(CLOSE_RATE, 'rate');
      emitStatus();
      return;
    }
    if (!config) return;
    const opened = openFrame(data.toString(), config.secret);
    if (!opened.ok) {
      if (opened.reason === 'signature') {
        const link = conn.link ?? (conn.direction === 'in' ? links.find((item) => item.ips.has(conn.remoteIp)) : null);
        if (link) {
          link.rejectedFrames += 1;
          if (link.state !== 'online') {
            link.state = 'rejected';
            link.message = 'Its frames fail the signature: the team secrets differ.';
          }
        }
        emitStatus();
      }
      return;
    }
    const frame = opened.frame;
    if (conn.instance === null) {
      if (!identify(conn, frame)) return;
    } else if (frame.from.instance !== conn.instance) {
      conn.ws.close(CLOSE_SPOOF, 'instance changed');
      return;
    }
    if (!remember(frame.id)) return;
    if (conn.link) conn.link.lastSeenAt = at;
    if (isAppLevel(frame)) {
      if (frame.kind === 'bye') {
        conn.goneReason = 'bye';
        conn.ws.close(1000, 'bye');
      }
      return;
    }
    for (const listen of frameListeners) listen(frame);
  }

  function onClose(conn: Conn, gen: number): void {
    conns.delete(conn);
    const peer = conn.instance ? peers.get(conn.instance) : undefined;
    if (peer?.conns.delete(conn) && peer.conns.size === 0 && conn.instance) {
      peers.delete(conn.instance);
      for (const listen of peerListeners) listen({ instance: conn.instance, change: 'gone', reason: conn.goneReason ?? 'closed' });
      // A link left waiting behind this connection dials again.
      for (const link of links) if (link.instance === conn.instance && !link.out && !link.timer && gen === generation) schedule(link, 0);
    }
    const link = conn.link;
    if (link && gen === generation) {
      if (link.out === conn) link.out = null;
      const stillOnline = link.instance ? (peers.get(link.instance)?.conns.size ?? 0) > 0 : false;
      if (!stillOnline && link.state !== 'rejected' && !link.self) {
        link.state = 'unreachable';
        link.message = conn.goneReason === 'bye' ? 'It closed Agent Lanes.' : conn.goneReason === 'expired' ? `Nothing heard for ${Math.round(expiryMs / 1000)} s.` : link.message;
      }
      if (conn.direction === 'out' && !link.self && !(conn.duplicate && stillOnline)) schedule(link);
    }
    if (gen === generation) emitStatus();
  }

  function track(ws: WebSocket, direction: 'in' | 'out', remoteIp: string, link: Link | null): Conn {
    const conn: Conn = { ws, direction, remoteIp, link, instance: null, lastActivity: now(), frameTimes: [], goneReason: null, duplicate: false, outbox: [], tokens: PEER_SEND_BURST, refilledAt: now(), pumpTimer: null };
    const gen = generation;
    conns.add(conn);
    ws.on('message', (data) => onMessage(conn, data));
    ws.on('close', () => {
      if (conn.pumpTimer) clearTimeout(conn.pumpTimer);
      onClose(conn, gen);
    });
    ws.on('error', (error) => {
      if ((error as { code?: string }).code === 'WS_ERR_UNSUPPORTED_MESSAGE_LENGTH') {
        refused += 1;
        options.log?.warn(`Peer lanes: closed a connection from ${remoteIp} for a frame over ${PEER_FRAME_MAX_BYTES} bytes`);
      }
    });
    return conn;
  }

  function schedule(link: Link, delay?: number): void {
    if (!config || link.self || link.timer) return;
    const wait = delay ?? Math.min(backoff.max, backoff.min * 2 ** link.attempt);
    link.attempt = Math.min(link.attempt + 1, 16);
    const gen = generation;
    link.timer = setTimeout(() => {
      link.timer = null;
      if (gen === generation) void dial(link, gen);
    }, wait);
  }

  async function dial(link: Link, gen: number): Promise<void> {
    if (link.out || (link.instance && (peers.get(link.instance)?.conns.size ?? 0) > 0)) return;
    try {
      link.ips = new Set(await resolve(link.host));
    } catch {
      if (gen !== generation) return;
      link.state = 'unreachable';
      link.message = `${link.host} could not be found.`;
      emitStatus();
      schedule(link);
      return;
    }
    if (gen !== generation) return;
    const host = link.host.includes(':') ? `[${link.host}]` : link.host;
    const ws = new WebSocket(`ws://${host}:${link.port}/`, { maxPayload: PEER_FRAME_MAX_BYTES, handshakeTimeout: HANDSHAKE_TIMEOUT_MS });
    const conn = track(ws, 'out', plainIp(link.host), link);
    link.out = conn;
    ws.on('open', () => {
      link.attempt = 0;
      hello(conn);
    });
    ws.on('unexpected-response', (_request, response) => {
      link.message = response.statusCode === 403 ? 'It refused the connection: this computer is not in its peer list.' : `It answered HTTP ${response.statusCode}.`;
      ws.terminate();
    });
    ws.on('error', (error) => {
      if (link.state !== 'online' && link.state !== 'rejected') link.message ??= `Could not connect: ${(error as { code?: string }).code ?? error.message}`;
    });
  }

  async function allowed(remote: string): Promise<boolean> {
    const ip = plainIp(remote);
    const verdict = acceptsAddress(ip, links);
    if (verdict !== 'unknown') return verdict === 'accept';
    if (now() - resolvedAt < RESOLVE_AGAIN_MS) return false;
    resolvedAt = now();
    await Promise.all(
      links.map(async (link) => {
        link.ips = new Set(await resolve(link.host).catch(() => [...link.ips]));
      }),
    );
    return links.some((link) => link.ips.has(ip));
  }

  async function listen(next: PeerConfig, gen: number): Promise<void> {
    // Only loopback peers listed: listen on loopback alone, so nothing on the LAN can reach the port.
    const host = options.bindHost ?? (links.length > 0 && links.every((link) => isLoopbackHost(link.host)) ? '127.0.0.1' : '0.0.0.0');
    await new Promise<void>((done) => {
      const wss = new WebSocketServer({
        host,
        port: next.port,
        maxPayload: PEER_FRAME_MAX_BYTES,
        verifyClient: (info, accept) => {
          void allowed(info.req.socket.remoteAddress ?? '').then((yes) => {
            if (!yes) {
              refused += 1;
              options.log?.warn(`Peer lanes: refused a connection from ${info.req.socket.remoteAddress ?? 'an unknown address'}`);
              emitStatus();
            }
            accept(yes, 403);
          });
        },
      });
      let settled = false;
      wss.once('listening', () => {
        settled = true;
        if (gen === generation) listener = { state: 'listening', port: (wss.address() as AddressInfo).port, message: null };
        done();
      });
      wss.on('error', (error) => {
        const code = (error as { code?: string }).code;
        if (settled) {
          options.log?.warn(`Peer lanes: listener error ${code ?? error.message}`);
          return;
        }
        settled = true;
        if (gen === generation) {
          listener = { state: 'failed', port: next.port, message: code === 'EADDRINUSE' ? `Port ${next.port} is in use. Other apps can't reach this one; it can still reach them.` : `The listener failed: ${error.message}` };
          options.log?.warn(`Peer lanes: ${listener.message}`);
        }
        server = null;
        wss.close();
        done();
      });
      wss.on('connection', (ws, request) => {
        const conn = track(ws, 'in', plainIp(request.socket.remoteAddress ?? ''), null);
        hello(conn);
      });
      server = wss;
    });
  }

  function tick(): void {
    const at = now();
    for (const conn of conns) {
      if (conn.instance && at - conn.lastActivity > expiryMs) {
        conn.goneReason = 'expired';
        conn.ws.terminate();
      }
    }
  }

  function heartbeat(): void {
    const frame = build({ kind: 'status', room: null, lane: null });
    if (frame) for (const peer of peers.values()) for (const conn of peer.conns) write(conn, frame);
  }

  async function stop(sayBye: boolean): Promise<void> {
    generation += 1;
    for (const interval of intervals.splice(0)) clearInterval(interval);
    if (sayBye) {
      // Straight out, ahead of anything still queued: the socket closes next.
      const bye = build({ kind: 'bye', room: null, lane: null });
      if (bye) for (const peer of peers.values()) for (const conn of peer.conns) if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify(bye));
    }
    for (const link of links) if (link.timer) clearTimeout(link.timer);
    const closing = [...conns].map(
      (conn) =>
        new Promise<void>((done) => {
          if (conn.ws.readyState === WebSocket.CLOSED) return done();
          conn.ws.once('close', () => done());
          conn.ws.close(1001, 'going away');
          setTimeout(() => {
            conn.ws.terminate();
            done();
          }, 1_000).unref();
        }),
    );
    await Promise.all(closing);
    for (const [instance] of peers) for (const listen of peerListeners) listen({ instance, change: 'gone', reason: 'closed' });
    peers.clear();
    conns.clear();
    const wss = server;
    server = null;
    if (wss) await new Promise<void>((done) => wss.close(() => done()));
    links = [];
    listener = { state: 'off', port: null, message: null };
  }

  return {
    async configure(next) {
      await stop(true);
      config = next;
      if (!next) {
        emitStatus();
        return;
      }
      const gen = generation;
      links = next.peers.flatMap((address) => {
        const parsed = parsePeerAddress(address);
        if (!parsed) return [];
        return [{ address: address.trim(), ...parsed, ips: new Set<string>(), state: 'connecting', message: null, instance: null, user: null, hostName: null, lastSeenAt: null, rejectedFrames: 0, out: null, timer: null, attempt: 0, self: false } satisfies Link];
      });
      await Promise.all(
        links.map(async (link) => {
          link.ips = new Set(await resolve(link.host).catch(() => []));
        }),
      );
      resolvedAt = now();
      await listen(next, gen);
      if (gen !== generation) return;
      intervals.push(setInterval(tick, Math.max(10, Math.min(heartbeatMs, expiryMs / 6))), setInterval(heartbeat, heartbeatMs));
      for (const interval of intervals) interval.unref();
      for (const link of links) void dial(link, gen);
      emitStatus();
    },
    broadcast(draft) {
      const frame = build(draft);
      if (!frame) return null;
      remember(frame.id);
      for (const peer of peers.values()) for (const conn of peer.conns) write(conn, frame);
      return frame;
    },
    sendTo(instance, draft) {
      const peer = peers.get(instance);
      const frame = peer ? build(draft) : null;
      if (!peer || !frame) return false;
      for (const conn of peer.conns) write(conn, frame);
      return true;
    },
    status,
    identity: () => options.identity(),
    online: () => [...peers.keys()],
    connections: () => [...conns].filter((conn) => conn.ws.readyState === WebSocket.OPEN && !conn.duplicate).map((conn) => ({ direction: conn.direction, instance: conn.instance })),
    onFrame(listen) {
      frameListeners.add(listen);
      return () => frameListeners.delete(listen);
    },
    onPeer(listen) {
      peerListeners.add(listen);
      return () => peerListeners.delete(listen);
    },
    async dispose() {
      await stop(true);
      config = null;
    },
  };
}
