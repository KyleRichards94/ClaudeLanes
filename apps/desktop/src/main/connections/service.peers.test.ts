import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectionSummarySchema } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SECRETS_FILE_NAME, createSecretStore } from '../secrets';
import { createFakeSafeStorage } from '../secrets/testing';
import { createMemoryConnectionsFile, type MemoryConnectionsFile } from './connections-file';
import { LEGACY_PEERS_SECRET_ID, PEERS_CONNECTION_ID, createConnectionsService } from './service';

/** AL-298: the Peers connection holds the two ports and the Advanced addresses, and no secret. */

/** Made up for these tests. */
const OLD_SECRET = 'office-team-secret-not-real-0000-Pz4Q';

let dir: string;
let key: Buffer;
let file: MemoryConnectionsFile;

function secretStore() {
  return createSecretStore({ filePath: join(dir, SECRETS_FILE_NAME), safeStorage: createFakeSafeStorage({ key }), warn: () => undefined });
}

function start() {
  const secrets = secretStore();
  const service = createConnectionsService({ file, secrets, emit: () => undefined, warn: () => undefined });
  return { service, secrets };
}

function okData<T>(result: { ok: true; data: T } | { ok: false; code: string; message: string }): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.message}`);
  return result.data;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-peers-connection-'));
  key = randomBytes(32);
  file = createMemoryConnectionsFile();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Peers connection', () => {
  it('saves the ports and addresses with no token, and changes them with Replace', async () => {
    const { service, secrets } = start();
    const row = okData(await service.save({ kind: 'peers', addresses: ['KYLE-PC', '10.0.0.12:47812'] }));
    expect(row).toMatchObject({ kind: 'peers', id: PEERS_CONNECTION_ID, name: 'Peers', port: 47811, beaconPort: 47810, addresses: ['KYLE-PC', '10.0.0.12:47812'], maskedToken: null });
    expect(await secrets.list()).toEqual([]);
    const listed = await service.list();
    expect(ConnectionSummarySchema.array().parse(listed)).toEqual(listed);

    const moved = okData(await service.replace({ id: PEERS_CONNECTION_ID, draft: { kind: 'peers', port: 47821, beaconPort: 47820, addresses: [] } }));
    expect(moved).toMatchObject({ port: 47821, beaconPort: 47820, addresses: [] });
  });

  it('allows one Peers connection, and refuses an address that is not a computer name or IP, or one listed twice', async () => {
    const { service } = start();
    okData(await service.save({ kind: 'peers' }));
    expect(await service.save({ kind: 'peers' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await service.replace({ id: PEERS_CONNECTION_ID, draft: { kind: 'peers', addresses: ['http://kyle-pc'] } })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await service.replace({ id: PEERS_CONNECTION_ID, draft: { kind: 'peers', addresses: ['KYLE-PC', 'kyle-pc'] } })).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('on first start after AL-298, deletes the old team secret and keeps the old peer list as the addresses', async () => {
    await secretStore().put(LEGACY_PEERS_SECRET_ID, OLD_SECRET);
    file = createMemoryConnectionsFile({
      version: 1,
      connections: [
        {
          kind: 'peers', id: 'peers', name: 'Peers', port: 47900, peers: ['KYLE-PC', 'localhost:47812'], secretId: LEGACY_PEERS_SECRET_ID, identity: null,
          maskedToken: '••••••••Pz4Q', expiresAt: null, status: 'ok', statusMessage: null, lastTestedAt: null, createdAt: '2026-10-29T00:00:00.000Z', updatedAt: '2026-10-29T00:00:00.000Z',
        },
      ],
    });

    const { service, secrets } = start();
    const [row] = await service.list();
    expect(row).toMatchObject({ kind: 'peers', port: 47900, beaconPort: 47810, addresses: ['KYLE-PC', 'localhost:47812'], maskedToken: null, needsReconnect: false });
    expect(await secrets.get(LEGACY_PEERS_SECRET_ID)).toBeUndefined();
    expect(await secretStore().list()).toEqual([]);
    expect(JSON.stringify(file.contents)).not.toContain(LEGACY_PEERS_SECRET_ID);
    expect(JSON.stringify(file.contents)).toContain('"addresses":["KYLE-PC","localhost:47812"]');
  });
});
