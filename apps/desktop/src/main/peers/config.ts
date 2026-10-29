import { createHash } from 'node:crypto';
import type { ConnectionsService } from '../connections';
import type { Logger } from '../logging';
import type { PeerConfig, PeerNetwork } from './network';

/**
 * Keeps the peer network on the saved Peers connection (AL-289): started once Connections load,
 * restarted when the port, the secret or the peer list changes, stopped when the connection goes.
 */
export interface PeerConfigSync {
  sync(): Promise<void>;
}

export function createPeerConfigSync(options: {
  connections: Pick<ConnectionsService, 'list' | 'secret'>;
  network: Pick<PeerNetwork, 'configure'>;
  log?: Pick<Logger, 'warn'>;
  /** The network was started, restarted or stopped. */
  onApplied?: () => void;
}): PeerConfigSync {
  let applied = 'off';
  let queue: Promise<void> = Promise.resolve();

  async function read(): Promise<PeerConfig | null> {
    const row = (await options.connections.list()).find((item) => item.kind === 'peers');
    if (row?.kind !== 'peers') return null;
    const secret = await options.connections.secret(row.id);
    if (secret === undefined) {
      options.log?.warn('Peer lanes: the team secret could not be read; replace it in Connections › Peers.');
      return null;
    }
    return { port: row.port, secret, peers: row.peers };
  }

  return {
    sync() {
      queue = queue.then(async () => {
        const config = await read();
        const key = config ? createHash('sha256').update(JSON.stringify([config.port, config.secret, config.peers])).digest('hex') : 'off';
        if (key === applied) return;
        applied = key;
        await options.network.configure(config);
        options.onApplied?.();
      });
      queue = queue.catch((cause) => options.log?.warn(`Peer lanes: could not apply the Peers connection: ${String(cause)}`));
      return queue;
    },
  };
}
