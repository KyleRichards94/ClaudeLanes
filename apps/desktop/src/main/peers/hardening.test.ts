import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { PeerFrame } from '@agent-lanes/contracts';
import { PEER_FRAME_MAX_BYTES, PEER_FRAMES_PER_SECOND, acceptsAddress } from './network';
import { signFrame } from './signer';
import type { PeerNetworkOptions } from './network';
import { createTestPeer, freePort, type TestPeer } from './testing';

/** AL-296 (PL§7): who may connect, and the caps that close a connection. */

const started: TestPeer[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate();
  await Promise.all(started.splice(0).map((peer) => peer.network.dispose()));
});

/** What `verifyClient` sees of a connecting socket. */
function fakeSocket(remoteAddress: string) {
  return { req: { socket: { remoteAddress } } };
}

const listed = [
  { host: 'KYLE-PC', ips: new Set(['10.0.0.12']) },
  { host: 'fe80::1', ips: new Set(['fe80::1']) },
];

describe('acceptsAddress', () => {
  it.each([
    ['8.8.8.8', 'refuse'],
    ['::ffff:203.0.113.9', 'refuse'],
    ['2001:4860::8888', 'refuse'],
    ['127.0.0.1', 'refuse'],
    ['::1', 'refuse'],
    ['10.0.0.12', 'accept'],
    ['::ffff:10.0.0.12', 'accept'],
    ['fe80::1', 'accept'],
    ['10.0.0.99', 'unknown'],
    ['192.168.1.20', 'unknown'],
  ] as const)('%s → %s', (address, verdict) => {
    expect(acceptsAddress(fakeSocket(address).req.socket.remoteAddress, listed)).toBe(verdict);
  });

  it('accepts loopback only while a loopback peer is listed', () => {
    expect(acceptsAddress('127.0.0.1', [...listed, { host: 'localhost', ips: new Set(['127.0.0.1', '::1']) }])).toBe('accept');
    expect(acceptsAddress('::1', [{ host: '127.0.0.1', ips: new Set(['127.0.0.1']) }])).toBe('accept');
  });
});

async function listening(peers: string[], options: Partial<PeerNetworkOptions> = {}): Promise<TestPeer> {
  const peer = createTestPeer('mitch', await freePort(), options);
  started.push(peer);
  await peer.network.configure({ port: peer.port, secret: 'team', peers });
  return peer;
}

function connect(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
  sockets.push(socket);
  socket.on('error', () => undefined);
  return new Promise((done, fail) => {
    socket.once('open', () => done(socket));
    socket.once('error', fail);
  });
}

const KYLE = randomUUID();

function hello(port: number): string {
  const frame: PeerFrame = signFrame(
    { v: 1, id: randomUUID(), room: null, kind: 'hello', from: { user: 'kyle', host: 'KYLE-PC', instance: KYLE, person: false }, lane: null, text: '', data: { port }, sentAt: new Date().toISOString(), replay: false },
    'team',
  );
  return JSON.stringify(frame);
}

describe('caps and filters on a live listener', () => {
  it('closes a connection from a host not in the peer list before any frame is read', async () => {
    // Listening on loopback, with only a LAN peer listed: this computer is not a listed host. No name
    // resolves, so nothing is dialled on the real network.
    const peer = await listening(['KYLE-PC'], { bindHost: '127.0.0.1', resolve: async () => Promise.reject(new Error('no DNS in this test')) });
    const frames = vi.fn();
    peer.network.onFrame(frames);
    const socket = new WebSocket(`ws://127.0.0.1:${peer.port}/`);
    sockets.push(socket);
    socket.on('error', () => undefined);
    const status = await new Promise<number>((done) => {
      socket.once('unexpected-response', (_request, response) => done(response.statusCode ?? 0));
      socket.once('open', () => done(101));
    });
    expect(status).toBe(403);
    expect(frames).not.toHaveBeenCalled();
    expect(peer.network.connections()).toEqual([]);
    expect(peer.network.status().refusedConnections).toBe(1);
  });

  it(`closes a connection that sends a frame over ${PEER_FRAME_MAX_BYTES / 1024} KB, and counts it`, async () => {
    const other = await freePort();
    const peer = await listening([`localhost:${other}`]);
    const socket = await connect(peer.port);
    socket.send(hello(other));
    await vi.waitFor(() => expect(peer.network.online()).toHaveLength(1));
    const closed = new Promise<number>((done) => socket.once('close', (code) => done(code)));
    socket.send('x'.repeat(65 * 1024));
    expect(await closed).toBe(1009);
    await vi.waitFor(() => expect(peer.network.status().refusedConnections).toBe(1));
  });

  it(`closes a connection that sends a ${PEER_FRAMES_PER_SECOND + 1}st frame in one second, and counts it`, async () => {
    const other = await freePort();
    const peer = await listening([`localhost:${other}`]);
    const socket = await connect(peer.port);
    const closed = new Promise<number>((done) => socket.once('close', (code) => done(code)));
    for (let n = 0; n <= PEER_FRAMES_PER_SECOND; n += 1) socket.send(hello(other));
    expect(await closed).toBe(4008);
    expect(peer.network.status().refusedConnections).toBe(1);
  });

  it('counts frames with a bad signature against the peer and shows them as rejected', async () => {
    const other = await freePort();
    const peer = await listening([`localhost:${other}`]);
    const socket = await connect(peer.port);
    const forged = JSON.parse(hello(other)) as PeerFrame;
    socket.send(JSON.stringify({ ...forged, sig: 'f'.repeat(64) }));
    socket.send(JSON.stringify(signFrame({ ...forged, id: randomUUID() }, 'another-team')));
    await vi.waitFor(() => expect(peer.network.status().peers[0]).toMatchObject({ state: 'rejected', rejectedFrames: 2 }));
    expect(peer.network.online()).toEqual([]);
  });
});
