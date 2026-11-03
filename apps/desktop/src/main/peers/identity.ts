import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, userInfo } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { ConnectionsService } from '../connections';
import type { PeerIdentity } from './network';

/**
 * Who this app is to its peers (PL§4 Identity): the name the ADO token test signed in as, the
 * computer's name, and an instance id made on first run and kept in `<userData>/peers/instance.json`.
 */

const InstanceFileSchema = z.object({ instance: z.uuid() });

export function peersDir(appDataDir: string): string {
  return join(appDataDir, 'peers');
}

/** The instance id from disk, or a new one written there. */
export function loadInstanceId(dir: string, warn?: (message: string) => void): string {
  const file = join(dir, 'instance.json');
  try {
    return InstanceFileSchema.parse(JSON.parse(readFileSync(file, 'utf8'))).instance;
  } catch {
    const instance = randomUUID();
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify({ instance }));
    } catch (cause) {
      warn?.(`Peer lanes: could not save the instance id: ${String(cause)}`);
    }
    return instance;
  }
}

export interface PeerIdentitySource {
  current(): PeerIdentity;
  /** Reads the ADO identity again (after a connection test). */
  refresh(): Promise<void>;
}

export function createPeerIdentity(options: { dir: string; connections: Pick<ConnectionsService, 'list'>; warn?: (message: string) => void }): PeerIdentitySource {
  const instance = loadInstanceId(options.dir, options.warn);
  const host = hostname() || 'unknown-host';
  let user = userInfo().username || 'Someone';
  return {
    current: () => ({ user, host, instance }),
    async refresh() {
      const rows = await options.connections.list().catch(() => []);
      const signedIn = rows.find((row) => row.kind === 'ado' && row.identity)?.identity;
      if (signedIn) user = signedIn;
    },
  };
}
