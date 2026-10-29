import { afterEach, describe, expect, it } from 'vitest';
import { probePeers } from './probe';
import { createTestPeer, freePort, type TestPeer } from './testing';

const started: TestPeer[] = [];

afterEach(async () => {
  await Promise.all(started.splice(0).map((peer) => peer.network.dispose()));
});

async function peer(user: string, secret: string, lists: string[]): Promise<TestPeer> {
  const made = createTestPeer(user, await freePort());
  started.push(made);
  await made.network.configure({ port: made.port, secret, peers: lists });
  return made;
}

describe('probePeers (AL-289 Test)', () => {
  it('reports who answered with the same secret, who signs with another, and who could not be reached', async () => {
    const appPort = await freePort();
    const kyle = await peer('kyle', 'team', [`localhost:${appPort}`]);
    const rocky = await peer('rocky', 'not-the-team', [`localhost:${appPort}`]);
    const nobody = await freePort();
    const addresses = [`localhost:${kyle.port}`, `localhost:${rocky.port}`, `localhost:${nobody}`];
    const probes = await probePeers(addresses, 'team', 'this-app', { timeoutMs: 2_000 });
    expect(probes).toEqual([
      { address: addresses[0], outcome: 'answered', user: 'kyle', host: 'KYLE-PC', message: null },
      { address: addresses[1], outcome: 'rejected', user: null, host: null, message: 'It signs with a different team secret.' },
      expect.objectContaining({ address: addresses[2], outcome: 'unreachable' }),
    ]);
    // Test leaves the peers' own connections alone.
    expect(kyle.network.online()).toEqual([]);
  });

  it('says so when the address is this app', async () => {
    const me = await peer('mitch', 'team', ['localhost:1']);
    const [probe] = await probePeers([`localhost:${me.port}`], 'team', me.instance, { timeoutMs: 2_000 });
    expect(probe).toMatchObject({ outcome: 'unreachable', message: 'That address is this app.' });
  });

  it('reports a refusal from a peer that does not list this computer', async () => {
    const kyle = await peer('kyle', 'team', ['10.9.9.9']);
    const [probe] = await probePeers([`localhost:${kyle.port}`], 'team', 'this-app', { timeoutMs: 2_000 });
    expect(probe).toMatchObject({ outcome: 'unreachable', message: 'It refused the connection: this computer is not in its peer list.' });
  });
});
