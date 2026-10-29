import { randomUUID } from 'node:crypto';
import { createSocket, type Socket } from 'node:dgram';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PeerBeaconSchema, type PeerBeacon } from '@agent-lanes/contracts';
import { beaconOf, beaconTargets, readBeacon } from './discovery';
import { deriveTeam } from './signer';
import { OTHER_TEAM, TEST_TEAM, beaconConfig, createTestPeer, freePort, freeUdpPort, type TestPeer } from './testing';

const started: TestPeer[] = [];
const sockets: Socket[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((peer) => peer.network.dispose()));
  for (const socket of sockets.splice(0)) socket.close();
});

async function peer(user: string, beaconPort: number, teams = [TEST_TEAM]): Promise<TestPeer> {
  const made = createTestPeer(user, await freePort());
  started.push(made);
  await made.network.configure(beaconConfig(made.port, beaconPort, teams));
  return made;
}

/** A beacon from no app at all, sent the way an app sends one. */
async function sendBeacon(beaconPort: number, beacon: PeerBeacon): Promise<void> {
  const socket = createSocket({ type: 'udp4', reuseAddr: true });
  sockets.push(socket);
  await new Promise<void>((done) => socket.bind(0, '127.0.0.1', done));
  socket.setBroadcast(true);
  await new Promise<void>((done, fail) => socket.send(JSON.stringify(beacon), beaconPort, '127.255.255.255', (error) => (error ? fail(error) : done())));
}

function stranger(teams: string[], port: number | null): PeerBeacon {
  return { v: 1, kind: 'beacon', instance: randomUUID(), host: 'ROCKY-PC', port, user: 'Rocky Smith', teams, sentAt: new Date().toISOString() };
}

describe('the beacon (AL-298)', () => {
  it('says who and where, and holds no organisation URL, project id, room, work item or text', async () => {
    const org = 'https://devops:8090/tfs/DefaultCollection';
    const projectId = '6ce954b1-ce1f-45d1-b94d-e6bf2464ba2c';
    const beacon = beaconOf({ user: 'Mitch Healy', host: 'MITCH-PC', instance: randomUUID() }, 47811, [deriveTeam(org, projectId).tag], Date.now());
    expect(Object.keys(beacon).sort()).toEqual(['host', 'instance', 'kind', 'port', 'sentAt', 'teams', 'user', 'v']);
    expect(PeerBeaconSchema.parse(beacon)).toEqual(beacon);
    const text = JSON.stringify(beacon).toLowerCase();
    for (const secretish of [org.toLowerCase(), 'devops:8090', 'defaultcollection', projectId, '48000', '#', 'room', 'text', 'lane']) expect(text).not.toContain(secretish);

    // And what an app actually puts on the wire.
    const beaconPort = await freeUdpPort();
    const heard: string[] = [];
    const listener = createSocket({ type: 'udp4', reuseAddr: true });
    sockets.push(listener);
    listener.on('message', (data) => heard.push(data.toString('utf8')));
    await new Promise<void>((done) => listener.bind({ port: beaconPort, address: '127.0.0.1', exclusive: false }, done));
    await peer('mitch', beaconPort);
    await vi.waitFor(() => expect(heard.length).toBeGreaterThan(0));
    const sent = JSON.parse(heard[0] ?? '{}') as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(['host', 'instance', 'kind', 'port', 'sentAt', 'teams', 'user', 'v']);
    expect(sent['teams']).toEqual([TEST_TEAM.tag]);
    expect(heard[0]).not.toContain('devops');
  });

  it('reads beacons from private and loopback addresses only, and not its own', () => {
    const self = randomUUID();
    const data = Buffer.from(JSON.stringify(stranger([TEST_TEAM.tag], 47811)));
    expect(readBeacon(data, '10.0.0.12', self)).toMatchObject({ ok: true });
    expect(readBeacon(data, '::ffff:192.168.1.20', self)).toMatchObject({ ok: true });
    expect(readBeacon(data, '127.0.0.1', self)).toMatchObject({ ok: true });
    expect(readBeacon(data, '203.0.113.9', self)).toEqual({ ok: false, reason: 'not-private' });
    expect(readBeacon(Buffer.from('{"kind":"beacon"}'), '10.0.0.12', self)).toEqual({ ok: false, reason: 'invalid' });
    expect(readBeacon(Buffer.from(JSON.stringify({ ...stranger([], 1), instance: self })), '10.0.0.12', self)).toEqual({ ok: false, reason: 'self' });
  });

  it('goes to loopback alone in e2e, and to the broadcast addresses otherwise', () => {
    expect(beaconTargets(true)).toEqual(['127.255.255.255']);
    expect(beaconTargets(false)).toContain('255.255.255.255');
  });
});

describe('finding peers by beacon (AL-298)', () => {
  it('finds another app with no addresses configured, and ends with one connection, dialled by the lower instance id', async () => {
    const beaconPort = await freeUdpPort();
    const [a, b] = [await peer('mitch', beaconPort), await peer('kyle', beaconPort)];
    await vi.waitFor(() => {
      expect(a.network.online()).toEqual([b.instance]);
      expect(b.network.online()).toEqual([a.instance]);
    }, { timeout: 5_000 });
    await new Promise((done) => setTimeout(done, 300));
    expect(a.network.connections()).toHaveLength(1);
    expect(b.network.connections()).toHaveLength(1);
    const [lower, higher] = a.instance < b.instance ? [a, b] : [b, a];
    expect(lower.network.connections()[0]?.direction).toBe('out');
    expect(higher.network.connections()[0]?.direction).toBe('in');
    expect(lower.network.status().peers).toEqual([expect.objectContaining({ source: 'found', state: 'online', instance: higher.instance, user: higher.user })]);
  });

  it('ignores and counts a beacon from another team, lists it as other team, and never dials it', async () => {
    const beaconPort = await freeUdpPort();
    const a = await peer('mitch', beaconPort);
    const other = await peer('rocky', beaconPort, [OTHER_TEAM]);
    await vi.waitFor(() => expect(a.network.status().peers).toEqual([expect.objectContaining({ instance: other.instance, state: 'other-team', user: 'rocky' })]));
    await vi.waitFor(() => expect(a.network.status().ignoredBeacons).toBeGreaterThan(1));
    expect(a.network.connections()).toEqual([]);
    expect(other.network.connections()).toEqual([]);
  });

  it('marks a found peer unreachable when its beacon stops, and waits to be dialled by one whose listener is down', async () => {
    const beaconPort = await freeUdpPort();
    const a = await peer('mitch', beaconPort);
    const quiet = stranger([TEST_TEAM.tag], null);
    await sendBeacon(beaconPort, quiet);
    await vi.waitFor(() => expect(a.network.status().peers).toEqual([expect.objectContaining({ instance: quiet.instance, state: 'connecting', message: 'Waiting for it to connect.' })]));
    expect(a.network.connections()).toEqual([]);
    await vi.waitFor(() => expect(a.network.status().peers[0]).toMatchObject({ state: 'unreachable', message: 'No beacon for 1 s.' }), { timeout: 3_000 });
  });

  it('counts a datagram on the beacon port that is not a beacon', async () => {
    const beaconPort = await freeUdpPort();
    const a = await peer('mitch', beaconPort);
    await sendBeacon(beaconPort, { hello: 'there' } as unknown as PeerBeacon);
    await vi.waitFor(() => expect(a.network.status().ignoredBeacons).toBe(1));
    expect(a.network.status().peers).toEqual([]);
  });

  it('reports the beacon port as listening, and as off once stopped', async () => {
    const beaconPort = await freeUdpPort();
    const a = await peer('mitch', beaconPort);
    expect(a.network.status().beacon).toEqual({ state: 'listening', port: beaconPort, message: null });
    await a.network.configure(null);
    expect(a.network.status().beacon.state).toBe('off');
  });
});
