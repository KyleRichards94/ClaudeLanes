import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import type { PeerLane } from '@agent-lanes/contracts';
import { createPeerNetwork, type PeerNetwork, type PeerNetworkOptions } from './network';

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
