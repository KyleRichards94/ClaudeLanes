import { createSocket, type Socket } from 'node:dgram';
import { networkInterfaces } from 'node:os';
import { PEER_PROTOCOL_VERSION, PeerBeaconSchema, type PeerBeacon, type PeerListener, type PeerTeamTag } from '@agent-lanes/contracts';
import type { Logger } from '../logging';
import { isLoopbackIp, isPrivateIp, plainIp } from './addresses';
import type { PeerIdentity } from './network';

/**
 * The UDP beacon (AL-298, PL§11): every app says who it is, where it listens and which teams it is
 * in, to the broadcast address of each office network it is on, and hears the same from the others.
 * Unsigned: it carries no organisation, project, room, work item or text.
 */

export const BEACON_MAX_BYTES = 2_048;

/** Everything a beacon says. */
export function beaconOf(me: PeerIdentity, port: number | null, teams: readonly PeerTeamTag[], at: number): PeerBeacon {
  return { v: PEER_PROTOCOL_VERSION, kind: 'beacon', instance: me.instance, host: me.host, port, user: me.user, teams: [...teams], sentAt: new Date(at).toISOString() };
}

export type ReadBeacon = { ok: true; beacon: PeerBeacon } | { ok: false; reason: 'self' | 'not-private' | 'invalid' };

/** A datagram from `from`: a private or loopback address, then JSON, then the schema. */
export function readBeacon(data: Buffer, from: string, self: string): ReadBeacon {
  const address = plainIp(from);
  if (!isPrivateIp(address) && !isLoopbackIp(address)) return { ok: false, reason: 'not-private' };
  if (data.length > BEACON_MAX_BYTES) return { ok: false, reason: 'invalid' };
  let value: unknown;
  try {
    value = JSON.parse(data.toString('utf8'));
  } catch {
    return { ok: false, reason: 'invalid' };
  }
  const parsed = PeerBeaconSchema.safeParse(value);
  if (!parsed.success) return { ok: false, reason: 'invalid' };
  return parsed.data.instance === self ? { ok: false, reason: 'self' } : { ok: true, beacon: parsed.data };
}

function directedBroadcast(address: string, netmask: string): string {
  const mask = netmask.split('.').map(Number);
  return address
    .split('.')
    .map((octet, index) => Number(octet) | (~(mask[index] ?? 255) & 255))
    .join('.');
}

/**
 * Where beacons go: the broadcast address of each private IPv4 network this computer is on, and
 * 255.255.255.255, which Windows sends out of one interface only. Loopback: this computer alone.
 */
export function beaconTargets(loopback: boolean): string[] {
  if (loopback) return ['127.255.255.255'];
  const targets = new Set<string>();
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal || !isPrivateIp(entry.address) || entry.netmask === '255.255.255.255') continue;
      targets.add(directedBroadcast(entry.address, entry.netmask));
    }
  }
  return [...targets, '255.255.255.255'];
}

export interface Discovery {
  readonly state: PeerListener;
  send(beacon: PeerBeacon): void;
  close(): Promise<void>;
}

/**
 * Binds the beacon port with `reuseAddr`, so two apps on one computer both hear every beacon. A port
 * that can't be bound is a `failed` state, not a throw: the app can still be found through Advanced.
 */
export async function openDiscovery(options: {
  port: number;
  loopback: boolean;
  self: string;
  onBeacon: (beacon: PeerBeacon, from: string) => void;
  onIgnored: (reason: 'not-private' | 'invalid') => void;
  targets?: readonly string[];
  log?: Pick<Logger, 'warn'>;
}): Promise<Discovery> {
  const socket: Socket = createSocket({ type: 'udp4', reuseAddr: true });
  const targets = options.targets ?? beaconTargets(options.loopback);
  let state: PeerListener = { state: 'off', port: null, message: null };
  let warned = false;

  socket.on('message', (data, remote) => {
    const read = readBeacon(data, remote.address, options.self);
    if (read.ok) options.onBeacon(read.beacon, plainIp(remote.address));
    else if (read.reason !== 'self') options.onIgnored(read.reason);
  });

  await new Promise<void>((done) => {
    socket.once('listening', () => {
      socket.setBroadcast(true);
      state = { state: 'listening', port: socket.address().port, message: null };
      done();
    });
    socket.once('error', (error) => {
      const code = (error as { code?: string }).code;
      state = { state: 'failed', port: options.port, message: code === 'EADDRINUSE' ? `UDP port ${options.port} is in use, so this app can't hear other apps' beacons.` : `The beacon failed: ${error.message}` };
      options.log?.warn(`Peer lanes: ${state.message}`);
      done();
    });
    socket.bind({ port: options.port, address: options.loopback ? '127.0.0.1' : '0.0.0.0', exclusive: false });
  });
  socket.on('error', (error) => options.log?.warn(`Peer lanes: beacon error ${(error as { code?: string }).code ?? error.message}`));

  return {
    get state() {
      return state;
    },
    send(beacon) {
      const port = state.port;
      if (state.state !== 'listening' || port === null) return;
      const data = Buffer.from(JSON.stringify(beacon));
      for (const target of targets) {
        socket.send(data, port, target, (error) => {
          // A network that can't broadcast (no interface, a strict VPN) says so once; Advanced addresses still work.
          if (error && !warned) {
            warned = true;
            options.log?.warn(`Peer lanes: a beacon to ${target} could not be sent: ${(error as { code?: string }).code ?? error.message}`);
          }
        });
      }
    },
    close() {
      return new Promise((done) => {
        try {
          socket.close(() => done());
        } catch {
          done();
        }
      });
    },
  };
}
