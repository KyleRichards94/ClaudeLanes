import type { PeerProbe } from '@agent-lanes/contracts';
import type { ConnectionTester } from './testers';

/**
 * The Peers connection's Test (AL-289, PL§2): every listed peer is dialled with the draft's team
 * secret. A peer that is off only says so; one that signs with another secret fails the test, since
 * nothing it sends would ever be read.
 */
export function createPeersConnectionTester(probe: (addresses: readonly string[], secret: string, signal: AbortSignal) => Promise<PeerProbe[]>): ConnectionTester<'peers'> {
  return async (draft, signal) => {
    const probes = await probe(draft.peers, draft.teamSecret ?? '', signal);
    const rejected = probes.filter((item) => item.outcome === 'rejected').map((item) => item.address);
    if (rejected.length === 0) return { status: 'ok', identity: null, message: null, peers: probes };
    return { status: 'error', identity: null, message: `${rejected.join(', ')} ${rejected.length === 1 ? 'uses' : 'use'} a different team secret.`, peers: probes };
  };
}
