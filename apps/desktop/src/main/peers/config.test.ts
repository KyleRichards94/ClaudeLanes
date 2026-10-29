import { describe, expect, it, vi } from 'vitest';
import type { ConnectionSummary } from '@agent-lanes/contracts';
import { createPeerConfigSync } from './config';

function peersRow(port: number, peers: string[]): ConnectionSummary {
  return {
    kind: 'peers', id: 'peers', name: 'Peers', port, peers, identity: null, maskedToken: '••••••••', expiresAt: null, status: 'ok', statusMessage: null,
    needsReconnect: false, lastTestedAt: null, createdAt: '2026-10-29T00:00:00.000Z', updatedAt: '2026-10-29T00:00:00.000Z',
  };
}

describe('createPeerConfigSync (AL-289)', () => {
  it('starts the network from the Peers connection, restarts it only when something changed, and stops it when the connection goes', async () => {
    let rows: ConnectionSummary[] = [];
    let secret = 'team';
    const configure = vi.fn(async () => undefined);
    const sync = createPeerConfigSync({ connections: { list: async () => rows, secret: async () => secret }, network: { configure } });

    await sync.sync();
    expect(configure).not.toHaveBeenCalled();

    rows = [peersRow(47811, ['KYLE-PC'])];
    await sync.sync();
    await sync.sync();
    expect(configure).toHaveBeenCalledTimes(1);
    expect(configure).toHaveBeenLastCalledWith({ port: 47811, secret: 'team', peers: ['KYLE-PC'] });

    rows = [peersRow(47900, ['KYLE-PC'])];
    await sync.sync();
    secret = 'new-team';
    await sync.sync();
    expect(configure).toHaveBeenCalledTimes(3);
    expect(configure).toHaveBeenLastCalledWith({ port: 47900, secret: 'new-team', peers: ['KYLE-PC'] });

    rows = [];
    await sync.sync();
    expect(configure).toHaveBeenLastCalledWith(null);
  });
});
