import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import type { PeerFrame } from '@agent-lanes/contracts';
import type { PeerEvent } from './network';
import { signFrame } from './signer';
import { OTHER_TEAM, TEST_ROOM, TEST_TEAM, createTestPeer, freePort, testConfig, testLane, type TestPeer } from './testing';

const started: TestPeer[] = [];
const closers: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((peer) => peer.network.dispose()));
  for (const close of closers.splice(0)) await close();
});

async function peer(user: string, port?: number): Promise<TestPeer> {
  const made = createTestPeer(user, port ?? (await freePort()));
  started.push(made);
  return made;
}

function listing(...peers: TestPeer[]): string[] {
  return peers.map((other) => `localhost:${other.port}`);
}

describe('peer network', () => {
  it('exchanges signed frames between two apps in one team, and leaves a third from another project as other team', async () => {
    const [a, b, c] = [await peer('mitch'), await peer('kyle'), await peer('rocky')];
    const received: Record<string, PeerFrame[]> = { b: [], c: [] };
    b.network.onFrame((frame) => received.b?.push(frame));
    c.network.onFrame((frame) => received.c?.push(frame));
    await a.network.configure(testConfig(a.port, listing(b, c)));
    await b.network.configure(testConfig(b.port, listing(a, c)));
    await c.network.configure(testConfig(c.port, listing(a, b), [OTHER_TEAM]));

    await vi.waitFor(() => expect(a.network.online()).toEqual([b.instance]), { timeout: 5_000 });
    await vi.waitFor(() => {
      const link = a.network.status().peers.find((item) => item.address === `localhost:${c.port}`);
      expect(link).toMatchObject({ state: 'other-team', message: 'It shares no Azure DevOps project with this app.' });
      expect(link?.rejectedFrames).toBeGreaterThan(0);
    });
    expect(a.network.status().peers.find((item) => item.address === `localhost:${b.port}`)).toMatchObject({ state: 'online', user: 'kyle', host: 'KYLE-PC', instance: b.instance });

    const sent = a.network.broadcast({ kind: 'ask', room: TEST_ROOM, lane: testLane(48162), text: 'Status, and where can I help?' });
    expect(sent).not.toBeNull();
    await vi.waitFor(() => expect(received.b?.map((frame) => frame.id)).toEqual([sent?.id]));
    expect(received.b?.[0]).toMatchObject({ kind: 'ask', from: { user: 'mitch', instance: a.instance, person: false }, text: 'Status, and where can I help?' });
    expect(received.c).toEqual([]);
    expect(c.network.online()).toEqual([]);
  });

  it('keeps exactly one connection when both sides connect at once', async () => {
    const [a, b] = [await peer('mitch'), await peer('kyle')];
    await Promise.all([
      a.network.configure(testConfig(a.port, listing(b))),
      b.network.configure(testConfig(b.port, listing(a))),
    ]);
    await vi.waitFor(() => {
      expect(a.network.online()).toEqual([b.instance]);
      expect(b.network.online()).toEqual([a.instance]);
    });
    // Let any duplicate close, then check it stays at one.
    await new Promise((done) => setTimeout(done, 300));
    expect(a.network.connections()).toHaveLength(1);
    expect(b.network.connections()).toHaveLength(1);
    const lower = a.instance < b.instance ? a : b;
    expect(lower.network.connections()[0]?.direction).toBe('out');
  });

  it('marks a peer that goes silent unreachable once it expires, and one that says bye at once', async () => {
    const a = await peer('mitch');
    const silentPort = await freePort();
    const events: PeerEvent[] = [];
    a.network.onPeer((event) => events.push(event));
    await a.network.configure(testConfig(a.port, [`localhost:${silentPort}`]));

    const instance = randomUUID();
    const frame = (kind: 'hello' | 'bye') =>
      JSON.stringify(
        signFrame(
          { v: 1, id: randomUUID(), room: null, team: TEST_TEAM.tag, kind, from: { user: 'kyle', host: 'KYLE-PC', instance, person: false }, lane: null, text: '', data: kind === 'hello' ? { port: silentPort } : {}, sentAt: new Date().toISOString(), replay: false },
          TEST_TEAM.key,
        ),
      );
    const connect = async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${a.port}/`);
      closers.push(() => ws.terminate());
      await new Promise((done) => ws.once('open', done));
      ws.send(frame('hello'));
      return ws;
    };

    await connect();
    await vi.waitFor(() => expect(a.network.status().peers[0]).toMatchObject({ state: 'online', instance }));
    await vi.waitFor(() => expect(events).toContainEqual({ instance, change: 'gone', reason: 'expired' }), { timeout: 5_000 });
    expect(a.network.status().peers[0]?.state).toBe('unreachable');

    const second = await connect();
    await vi.waitFor(() => expect(a.network.status().peers[0]?.state).toBe('online'));
    const byeAt = Date.now();
    second.send(frame('bye'));
    await vi.waitFor(() => expect(events.filter((event) => event.change === 'gone')).toHaveLength(2));
    expect(events.at(-1)).toEqual({ instance, change: 'gone', reason: 'bye' });
    expect(Date.now() - byeAt).toBeLessThan(500);
    expect(a.network.status().peers[0]).toMatchObject({ state: 'unreachable', message: 'It closed Agent Lanes.' });
  });

  it('marks a peer whose frames carry this team but fail its key as signature rejected', async () => {
    const a = await peer('mitch');
    const otherPort = await freePort();
    await a.network.configure(testConfig(a.port, [`localhost:${otherPort}`]));
    const ws = new WebSocket(`ws://127.0.0.1:${a.port}/`);
    closers.push(() => ws.terminate());
    await new Promise((done) => ws.once('open', done));
    const forged = signFrame(
      { v: 1, id: randomUUID(), room: null, team: TEST_TEAM.tag, kind: 'hello', from: { user: 'kyle', host: 'KYLE-PC', instance: randomUUID(), person: false }, lane: null, text: '', data: { port: otherPort }, sentAt: new Date().toISOString(), replay: false },
      OTHER_TEAM.key,
    );
    ws.send(JSON.stringify(forged));
    await vi.waitFor(() => expect(a.network.status().peers[0]).toMatchObject({ state: 'rejected', rejectedFrames: 1 }));
    expect(a.network.online()).toEqual([]);
  });

  it('reports a port in use as a status, not a crash', async () => {
    const taken: Server = createServer();
    await new Promise<void>((done) => taken.listen(0, '127.0.0.1', done));
    closers.push(() => new Promise<void>((done) => taken.close(() => done())));
    const port = (taken.address() as { port: number }).port;
    const a = await peer('mitch', port);
    const other = await freePort();
    await a.network.configure(testConfig(port, [`localhost:${other}`]));
    expect(a.network.status().listener).toMatchObject({ state: 'failed', port });
    expect(a.network.status().listener.message).toContain('in use');
  });

  it('paces a burst under the other side’s cap, so all of it arrives on one connection', async () => {
    const [a, b] = [await peer('mitch'), await peer('kyle')];
    const received: PeerFrame[] = [];
    b.network.onFrame((frame) => received.push(frame));
    await a.network.configure(testConfig(a.port, listing(b)));
    await b.network.configure(testConfig(b.port, listing(a)));
    await vi.waitFor(() => expect(a.network.online()).toEqual([b.instance]));
    for (let n = 1; n <= 40; n += 1) a.network.broadcast({ kind: 'ask', room: TEST_ROOM, lane: testLane(48162), text: `Question ${n}` });
    await vi.waitFor(() => expect(received).toHaveLength(40), { timeout: 10_000 });
    expect(received.map((frame) => frame.text)).toEqual(Array.from({ length: 40 }, (_, index) => `Question ${index + 1}`));
    expect(b.network.status().refusedConnections).toBe(0);
  }, 15_000);

  it('drops a frame id it has already seen', async () => {
    const [a, b] = [await peer('mitch'), await peer('kyle')];
    const received: PeerFrame[] = [];
    b.network.onFrame((frame) => received.push(frame));
    await a.network.configure(testConfig(a.port, listing(b)));
    await b.network.configure(testConfig(b.port, listing(a)));
    await vi.waitFor(() => expect(a.network.online()).toEqual([b.instance]));
    const first = a.network.broadcast({ kind: 'done', room: TEST_ROOM, lane: testLane(48162), text: 'PR open' });
    a.network.sendTo(b.instance, { kind: 'done', room: TEST_ROOM, lane: testLane(48162), text: 'PR open', id: first?.id, sentAt: first?.sentAt });
    a.network.broadcast({ kind: 'done', room: TEST_ROOM, lane: testLane(48162), text: 'Second' });
    await vi.waitFor(() => expect(received.map((frame) => frame.text)).toEqual(['PR open', 'Second']));
  });
});
