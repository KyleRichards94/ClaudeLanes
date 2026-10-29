import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConnectionSummarySchema, ConnectionTestResultSchema, type PeerProbe } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SECRETS_FILE_NAME, createSecretStore } from '../secrets';
import { createFakeSafeStorage } from '../secrets/testing';
import { createMemoryConnectionsFile, type MemoryConnectionsFile } from './connections-file';
import { createPeersConnectionTester } from './peers';
import { PEERS_CONNECTION_ID, createConnectionsService } from './service';

/** AL-289: the Peers connection keeps its team secret in the SecretStore and shows only its tail. */

/** Made up for these tests. */
const SECRET = 'office-team-secret-not-real-0000-Pz4Q';
const SECRET_2 = 'office-team-secret-second-0000-Kd8W';

let dir: string;
let key: Buffer;
let file: MemoryConnectionsFile;
let probes: PeerProbe[];
let probed: Array<{ addresses: readonly string[]; secret: string }>;

function start() {
  const secrets = createSecretStore({ filePath: join(dir, SECRETS_FILE_NAME), safeStorage: createFakeSafeStorage({ key }), warn: () => undefined });
  const service = createConnectionsService({
    file,
    secrets,
    emit: () => undefined,
    testers: {
      peers: createPeersConnectionTester(async (addresses, secret) => {
        probed.push({ addresses, secret });
        return probes;
      }),
    },
    warn: () => undefined,
  });
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
  probes = [];
  probed = [];
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('Peers connection', () => {
  it('stores the team secret in the SecretStore and lists only its tail', async () => {
    const { service, secrets } = start();
    const row = okData(await service.save({ kind: 'peers', teamSecret: SECRET, peers: ['KYLE-PC', '10.0.0.12:47812'] }));
    expect(row).toMatchObject({ kind: 'peers', id: PEERS_CONNECTION_ID, name: 'Peers', port: 47811, peers: ['KYLE-PC', '10.0.0.12:47812'], maskedToken: `${'•'.repeat(8)}Pz4Q` });
    expect(await secrets.get('peers:team-secret')).toBe(SECRET);
    const listed = await service.list();
    expect(ConnectionSummarySchema.array().parse(listed)).toEqual(listed);
    expect(JSON.stringify(listed)).not.toContain(SECRET);
    expect(JSON.stringify(file.contents)).not.toContain(SECRET);
    expect(await readFile(join(dir, SECRETS_FILE_NAME), 'utf8')).not.toContain(SECRET);
    expect(await service.secret(PEERS_CONNECTION_ID)).toBe(SECRET);
  });

  it('keeps the saved secret when a Replace leaves it out, and takes a new one when given', async () => {
    const { service } = start();
    okData(await service.save({ kind: 'peers', teamSecret: SECRET, peers: ['KYLE-PC'] }));
    const moved = okData(await service.replace({ id: PEERS_CONNECTION_ID, draft: { kind: 'peers', port: 47900, peers: ['KYLE-PC', 'ROCKY-PC'] } }));
    expect(moved).toMatchObject({ port: 47900, peers: ['KYLE-PC', 'ROCKY-PC'], maskedToken: `${'•'.repeat(8)}Pz4Q` });
    expect(await service.secret(PEERS_CONNECTION_ID)).toBe(SECRET);
    okData(await service.replace({ id: PEERS_CONNECTION_ID, draft: { kind: 'peers', teamSecret: SECRET_2, peers: ['KYLE-PC'] } }));
    expect(await service.secret(PEERS_CONNECTION_ID)).toBe(SECRET_2);
  });

  it('allows one Peers connection, and needs a secret for the first', async () => {
    const { service } = start();
    expect(await service.save({ kind: 'peers', peers: ['KYLE-PC'] })).toMatchObject({ ok: false, code: 'VALIDATION', message: 'Enter the team secret.' });
    okData(await service.save({ kind: 'peers', teamSecret: SECRET, peers: [] }));
    expect(await service.save({ kind: 'peers', teamSecret: SECRET_2, peers: [] })).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('refuses a peer that is not a computer name or address, and a peer listed twice', async () => {
    const { service } = start();
    expect(await service.save({ kind: 'peers', teamSecret: SECRET, peers: ['http://kyle-pc'] })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await service.save({ kind: 'peers', teamSecret: SECRET, peers: ['KYLE-PC', 'kyle-pc'] })).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('tests a draft against each peer and reports the three outcomes, failing only on a rejected secret', async () => {
    const { service } = start();
    probes = [
      { address: 'KYLE-PC', outcome: 'answered', user: 'Kyle Richards', host: 'KYLE-PC', message: null },
      { address: 'ROCKY-PC', outcome: 'unreachable', user: null, host: null, message: 'Could not connect: ECONNREFUSED' },
    ];
    const passed = okData(await service.test({ draft: { kind: 'peers', teamSecret: SECRET, peers: ['KYLE-PC', 'ROCKY-PC'] } }));
    expect(ConnectionTestResultSchema.parse(passed)).toMatchObject({ status: 'ok', peers: probes });
    expect(probed.at(-1)).toEqual({ addresses: ['KYLE-PC', 'ROCKY-PC'], secret: SECRET });

    probes = [...probes, { address: '10.0.0.30', outcome: 'rejected', user: null, host: null, message: 'It signs with a different team secret.' }];
    const failed = okData(await service.test({ draft: { kind: 'peers', teamSecret: SECRET, peers: ['KYLE-PC', 'ROCKY-PC', '10.0.0.30'] } }));
    expect(failed).toMatchObject({ status: 'error', message: '10.0.0.30 uses a different team secret.' });
    expect(failed.peers?.map((probe) => probe.outcome)).toEqual(['answered', 'unreachable', 'rejected']);
  });

  it('tests a changed peer list with the saved secret, and never returns the secret', async () => {
    const { service } = start();
    okData(await service.save({ kind: 'peers', teamSecret: SECRET, peers: ['KYLE-PC'] }));
    const result = okData(await service.test({ draft: { kind: 'peers', peers: ['KYLE-PC', 'ROCKY-PC'] } }));
    expect(probed.at(-1)?.secret).toBe(SECRET);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
