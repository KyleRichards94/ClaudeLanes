import type { PeerNetworkStatus } from '../domains/peers.schemas';

/** A peer network that is up with no peers yet; pass what a test needs to differ. */
export function peerNetworkFixture(overrides: Partial<PeerNetworkStatus> = {}): PeerNetworkStatus {
  return {
    identity: { user: 'Mitch Healy', host: 'MITCH-PC', instance: '9a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d' },
    listener: { state: 'listening', port: 47811, message: null },
    beacon: { state: 'listening', port: 47810, message: null },
    peers: [],
    teams: 1,
    refusedConnections: 0,
    ignoredBeacons: 0,
    ...overrides,
  };
}
