import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import type { PeerLane } from '@agent-lanes/contracts';
import { createPeerNetwork, type PeerConfig, type PeerNetwork, type PeerNetworkOptions } from './network';
import { deriveTeam, type PeerTeamKey } from './signer';

/** A port nothing listens on right now. */
export async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => done(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

export interface TestPeer {
  readonly network: PeerNetwork;
  readonly port: number;
  readonly instance: string;
  readonly user: string;
}

/** A network on loopback with fast heartbeats, for tests that run several in one process. */
export function createTestPeer(user: string, port: number, options: Partial<PeerNetworkOptions> = {}): TestPeer {
  const instance = randomUUID();
  const network = createPeerNetwork({
    identity: () => ({ user, host: `${user.toUpperCase()}-PC`, instance }),
    heartbeatMs: 250,
    expiryMs: 1_500,
    backoffMs: { min: 20, max: 200 },
    ...options,
  });
  return { network, port, instance, user };
}

export function testLane(workItemId: number, overrides: Partial<PeerLane> = {}): PeerLane {
  return { ticketId: String(workItemId), workItemId, title: `Story ${workItemId}`, stage: 'implementing', branch: `${workItemId}-story`, parentId: 48000, ...overrides };
}

export const TEST_ROOM = 'https://devops:8090/tfs/defaultcollection#48000';
/** The team of TEST_ROOM's organisation, and one from another project. */
export const TEST_TEAM = deriveTeam('https://devops:8090/tfs/DefaultCollection', '6ce954b1-ce1f-45d1-b94d-e6bf2464ba2c');
export const OTHER_TEAM = deriveTeam('https://devops:8090/tfs/DefaultCollection', '0f7a4c2e-1b3d-4e5f-8a6b-9c0d1e2f3a4b');

/** A config listening on `port` and dialling the given addresses, in TEST_TEAM unless told otherwise. */
export function testConfig(port: number, addresses: readonly string[], teams: readonly PeerTeamKey[] = [TEST_TEAM]): PeerConfig {
  return { port, addresses, teams };
}
