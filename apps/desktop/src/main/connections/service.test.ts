import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConnectionSummary, EventChannel } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { Emit } from '../ipc/emit';
import { SECRETS_FILE_NAME, SecretStoreError, createSecretStore, type SecretStore } from '../secrets';
import { createFakeSafeStorage } from '../secrets/testing';
import { createMemoryConnectionsFile, type MemoryConnectionsFile } from './connections-file';
import { RECONNECT_MESSAGE, createConnectionsService } from './service';
import type { ConnectionTestOutcome, ConnectionTesters, DraftOf } from './testers';

/** Made up for these tests; shaped like real tokens, valid nowhere. */
const PAT = 'fakepat0000test1111only2222never3333real4444abcd7Fq2';
const PAT_2 = 'fakepat9999second8888token7777for6666replace5555Zx9K';
const OTHER_PAT = 'fakepat1212fabrikam3434only5656never7878real9090Qw3E';
const API_KEY = 'sk-ant-test-0000-not-a-real-key-0000-Ab12';
const MCP_TOKEN = 'ghp_fake000000000000000000000000000Mcp1';
const ALL_TOKENS = [PAT, PAT_2, OTHER_PAT, API_KEY, MCP_TOKEN];

const ORG_URL = 'https://dev.azure.com/CompanionSystems';
const adoDraft = { kind: 'ado', orgUrl: `${ORG_URL}/`, pat: PAT } as const;
const claudeKeyDraft = { kind: 'claude', mode: 'api-key', apiKey: API_KEY } as const;
const mcpDraft = {
  kind: 'mcp' as const,
  name: 'GitHub',
  transport: { type: 'stdio' as const, command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], envVar: 'GITHUB_PERSONAL_ACCESS_TOKEN' },
  token: MCP_TOKEN,
};

let dir: string;
let key: Buffer;
let file: MemoryConnectionsFile;
let events: Array<{ channel: EventChannel; payload: unknown }>;
let warnings: string[];
let adoTester: Mock<(draft: DraftOf<'ado'>, signal: AbortSignal) => Promise<ConnectionTestOutcome>>;
let clock: number;

const emit: Emit = (channel, payload) => {
  events.push({ channel, payload });
};

function openSecrets(): SecretStore {
  return createSecretStore({ filePath: join(dir, SECRETS_FILE_NAME), safeStorage: createFakeSafeStorage({ key }), warn: () => undefined });
}

function start(options: { secrets?: SecretStore; testers?: ConnectionTesters } = {}) {
  const secrets = options.secrets ?? openSecrets();
  const service = createConnectionsService({
    file,
    secrets,
    emit,
    testers: options.testers ?? { ado: adoTester },
    now: () => new Date(clock),
    warn: (message) => warnings.push(message),
  });
  return { service, secrets };
}

async function secretsFileText(): Promise<string> {
  return readFile(join(dir, SECRETS_FILE_NAME), 'utf8');
}

function okData<T>(result: { ok: true; data: T } | { ok: false; code: string; message: string }): T {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.message}`);
  return result.data;
}

function expectNoToken(value: unknown): void {
  const text = JSON.stringify(value) ?? '';
  for (const token of ALL_TOKENS) {
    expect(text).not.toContain(token);
    expect(text).not.toContain(Buffer.from(`:${token}`).toString('base64'));
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-connections-'));
  key = randomBytes(32);
  file = createMemoryConnectionsFile();
  events = [];
  warnings = [];
  clock = Date.parse('2026-10-07T03:00:00.000Z');
  adoTester = vi.fn(async (): Promise<ConnectionTestOutcome> => ({ status: 'ok', identity: 'Kyle Richards', message: null }));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('ConnectionsService', () => {
  describe('save', () => {
    it('puts the PAT in the SecretStore and returns a status row with a masked token', async () => {
      const { service } = start();
      const row = okData(await service.save(adoDraft));

      expect(row).toEqual({
        kind: 'ado',
        id: 'ado:companionsystems',
        name: 'CompanionSystems',
        orgUrl: ORG_URL,
        defaultProject: null,
        identity: null,
        maskedToken: '••••••••7Fq2',
        expiresAt: null,
        status: 'untested',
        statusMessage: null,
        needsReconnect: false,
        missingScopes: [],
        lastTestedAt: null,
        createdAt: '2026-10-07T03:00:00.000Z',
        updatedAt: '2026-10-07T03:00:00.000Z',
      } satisfies ConnectionSummary);
      await expect(service.secret('ado:companionsystems')).resolves.toBe(PAT);
      expect(events).toEqual([{ channel: 'connections:changed', payload: {} }]);
    });

    it('keeps the token out of both files on disk', async () => {
      const { service } = start();
      okData(await service.save(adoDraft));
      okData(await service.save(claudeKeyDraft));
      okData(await service.save(mcpDraft));

      expectNoToken(file.contents);
      expect(file.contents).toMatchObject({
        version: 1,
        connections: [{ id: 'ado:companionsystems', secretId: 'ado:companionsystems' }, { id: 'claude', secretId: 'claude:api-key' }, { id: 'mcp:github', secretId: 'mcp:github' }],
      });
      const secretsFile = await secretsFileText();
      for (const token of ALL_TOKENS) expect(secretsFile).not.toContain(token);
      expect(Object.keys((JSON.parse(secretsFile) as { secrets: object }).secrets).sort()).toEqual(['ado:companionsystems', 'claude:api-key', 'mcp:github']);
    });

    it('shows the outcome of a test of the same draft run just before, without testing again', async () => {
      const { service } = start();
      const tested = okData(await service.test({ draft: adoDraft }));
      expect(tested).toEqual({ status: 'ok', identity: 'Kyle Richards', message: null, missingScopes: [], testedAt: '2026-10-07T03:00:00.000Z' });

      clock += 60_000;
      const row = okData(await service.save({ ...adoDraft, defaultProject: 'OnSite Companion', expiresAt: '2027-01-12' }));
      expect(row).toMatchObject({
        status: 'ok',
        identity: 'Kyle Richards',
        lastTestedAt: '2026-10-07T03:00:00.000Z',
        defaultProject: 'OnSite Companion',
        expiresAt: '2027-01-12',
      });
      expect(adoTester).toHaveBeenCalledOnce();
    });

    it('does not reuse a test of a different token, or one older than 15 minutes', async () => {
      const { service } = start();
      okData(await service.test({ draft: { ...adoDraft, pat: OTHER_PAT } }));
      expect(okData(await service.save(adoDraft)).status).toBe('untested');

      okData(await service.remove('ado:companionsystems'));
      okData(await service.test({ draft: adoDraft }));
      clock += 16 * 60_000;
      expect(okData(await service.save(adoDraft)).status).toBe('untested');
    });

    it('refuses a second connection to the same organisation and points at the first', async () => {
      const { service } = start();
      okData(await service.save(adoDraft));
      const again = await service.save({ ...adoDraft, orgUrl: 'https://dev.azure.com/companionsystems', pat: OTHER_PAT });

      expect(again).toMatchObject({ ok: false, code: 'VALIDATION', details: { id: 'ado:companionsystems' } });
      await expect(service.secret('ado:companionsystems')).resolves.toBe(PAT);
      expect(file.writes).toBe(1);
    });

    it('allows one Claude connection and one MCP server per name', async () => {
      const { service } = start();
      okData(await service.save({ kind: 'claude', mode: 'login' }));
      okData(await service.save(mcpDraft));
      expect(await service.save(claudeKeyDraft)).toMatchObject({ ok: false, code: 'VALIDATION', details: { id: 'claude' } });
      expect(await service.save({ ...mcpDraft, name: 'github' })).toMatchObject({ ok: false, code: 'VALIDATION', details: { id: 'mcp:github' } });
    });

    it('gives organisations with the same name on different servers their own ids', async () => {
      const { service } = start();
      okData(await service.save({ kind: 'ado', orgUrl: 'https://tfs.contoso.test/tfs/DefaultCollection', pat: PAT }));
      const second = okData(await service.save({ kind: 'ado', orgUrl: 'https://tfs.fabrikam.test/DefaultCollection', pat: OTHER_PAT }));

      expect(second).toMatchObject({ id: 'ado:defaultcollection-2', name: 'DefaultCollection' });
      await expect(service.secret('ado:defaultcollection')).resolves.toBe(PAT);
      await expect(service.secret('ado:defaultcollection-2')).resolves.toBe(OTHER_PAT);
    });

    it('refuses an organisation URL the ADO client would not send a token to', async () => {
      const { service } = start();
      const result = await service.save({ ...adoDraft, orgUrl: 'http://dev.azure.com/contoso' });
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
      expect(file.writes).toBe(0);
      await expect(openSecrets().list()).resolves.toEqual([]);
    });

    it('refuses an MCP URL that carries credentials', async () => {
      const { service } = start();
      const result = await service.save({
        kind: 'mcp',
        name: 'Docs',
        transport: { type: 'http', url: `https://user:${MCP_TOKEN}@mcp.example.test/mcp`, header: null },
      });
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
      expectNoToken(result);
    });

    it('saves nothing when the OS cannot encrypt', async () => {
      const secrets = createSecretStore({
        filePath: join(dir, SECRETS_FILE_NAME),
        safeStorage: createFakeSafeStorage({ key, available: false }),
        warn: () => undefined,
      });
      const { service } = start({ secrets });
      const result = await service.save(adoDraft);

      expect(result).toMatchObject({ ok: false, code: 'INTERNAL', details: { secretStore: 'ENCRYPTION_UNAVAILABLE' } });
      expect(file.writes).toBe(0);
      await expect(service.list()).resolves.toEqual([]);
    });

    it('takes the token back out of the SecretStore when connections.json cannot be written', async () => {
      const { service, secrets } = start();
      file.failWrites = true;
      const result = await service.save(adoDraft);

      expect(result).toMatchObject({ ok: false, code: 'INTERNAL' });
      await expect(secrets.list()).resolves.toEqual([]);
      await expect(service.list()).resolves.toEqual([]);
      expect(events).toEqual([]);
    });

    it('saves two organisations at once without losing either', async () => {
      const { service } = start();
      const [first, second] = await Promise.all([
        service.save(adoDraft),
        service.save({ kind: 'ado', orgUrl: 'https://dev.azure.com/fabrikam', pat: OTHER_PAT }),
      ]);
      expect(first.ok && second.ok).toBe(true);
      expect((await service.list()).map((row) => row.id)).toEqual(['ado:companionsystems', 'ado:fabrikam']);
    });
  });

  describe('list', () => {
    it('lists ADO organisations by name, then Claude, then MCP servers, with no token anywhere', async () => {
      const { service } = start();
      okData(await service.save(mcpDraft));
      okData(await service.save({ kind: 'mcp', name: 'Docs', transport: { type: 'http', url: 'https://mcp.example.test/mcp', header: null } }));
      okData(await service.save(claudeKeyDraft));
      okData(await service.save({ kind: 'ado', orgUrl: 'https://dev.azure.com/fabrikam', pat: OTHER_PAT }));
      okData(await service.save(adoDraft));

      const rows = await service.list();
      expect(rows.map((row) => [row.id, row.name, row.maskedToken])).toEqual([
        ['ado:companionsystems', 'CompanionSystems', '••••••••7Fq2'],
        ['ado:fabrikam', 'fabrikam', '••••••••Qw3E'],
        ['claude', 'Claude', '••••••••Ab12'],
        ['mcp:docs', 'Docs', null],
        ['mcp:github', 'GitHub', '••••••••Mcp1'],
      ]);
      expectNoToken(rows);
    });

    it('survives a restart', async () => {
      const { service } = start();
      okData(await service.save(adoDraft));
      okData(await service.save({ kind: 'claude', mode: 'login' }));

      const restarted = start().service;
      expect(await restarted.list()).toEqual(await service.list());
      await expect(restarted.secret('ado:companionsystems')).resolves.toBe(PAT);
    });
  });

  describe('test', () => {
    it('re-tests a saved connection, updates its row and announces the change', async () => {
      const { service } = start();
      okData(await service.save(adoDraft));
      events.length = 0;
      clock += 60_000;

      const result = okData(await service.test({ id: 'ado:companionsystems' }));
      expect(result).toMatchObject({ status: 'ok', identity: 'Kyle Richards', testedAt: '2026-10-07T03:01:00.000Z' });
      expect(adoTester).toHaveBeenCalledWith({ kind: 'ado', orgUrl: ORG_URL, pat: PAT, defaultProject: null, expiresAt: null }, expect.any(AbortSignal));
      expect(await service.get('ado:companionsystems')).toMatchObject({
        status: 'ok',
        identity: 'Kyle Richards',
        lastTestedAt: '2026-10-07T03:01:00.000Z',
        updatedAt: '2026-10-07T03:00:00.000Z',
      });
      expect(events).toEqual([{ channel: 'connections:changed', payload: {} }]);
    });

    it('marks a failing connection red with the reason, keeping who it signed in as', async () => {
      const { service } = start();
      okData(await service.test({ draft: adoDraft }));
      okData(await service.save(adoDraft));
      adoTester.mockResolvedValueOnce({
        status: 'error',
        identity: null,
        message: `Azure DevOps rejected the personal access token ${PAT} (401).`,
        missingScopes: ['build'],
      });

      const result = okData(await service.test({ id: 'ado:companionsystems' }));
      expect(result).toMatchObject({ status: 'error', identity: null, missingScopes: ['build'] });
      expect(result.message).toBe('Azure DevOps rejected the personal access token •••••••• (401).');
      expect(await service.get('ado:companionsystems')).toMatchObject({
        status: 'error',
        identity: 'Kyle Richards',
        statusMessage: result.message,
        missingScopes: ['build'],
      });
    });

    it('reports a tester that throws as a failed test, with the token scrubbed out', async () => {
      adoTester.mockRejectedValueOnce(new Error(`socket hang up while sending Basic ${Buffer.from(`:${PAT}`).toString('base64')}`));
      const { service } = start();
      const result = okData(await service.test({ draft: adoDraft }));

      expect(result).toMatchObject({ status: 'error', identity: null });
      expect(result.message).toContain('socket hang up');
      expectNoToken(result);
    });

    it('says when a kind cannot be tested yet', async () => {
      const { service } = start();
      const result = await service.test({ draft: claudeKeyDraft });
      expect(result).toMatchObject({ ok: false, code: 'INTERNAL', message: expect.stringContaining('Claude') });
    });

    it('gives each tester its kind of draft, MCP tokens and Claude keys included', async () => {
      const claude = vi.fn(async (_draft: DraftOf<'claude'>, _signal: AbortSignal): Promise<ConnectionTestOutcome> => ({
        status: 'ok',
        identity: 'kyle@example.test',
        message: null,
      }));
      const mcp = vi.fn(async (_draft: DraftOf<'mcp'>, _signal: AbortSignal): Promise<ConnectionTestOutcome> => ({
        status: 'ok',
        identity: null,
        message: null,
        missingScopes: ['code'],
      }));
      const { service } = start({ testers: { claude, mcp } });

      expect(okData(await service.test({ draft: claudeKeyDraft }))).toMatchObject({ status: 'ok', identity: 'kyle@example.test' });
      expect(claude).toHaveBeenCalledWith(claudeKeyDraft, expect.any(AbortSignal));
      // Only ADO has scopes.
      expect(okData(await service.test({ draft: mcpDraft })).missingScopes).toEqual([]);
      expect(mcp).toHaveBeenCalledWith(mcpDraft, expect.any(AbortSignal));
    });

    it('does not let a test that finishes after a replace overwrite the new row', async () => {
      const { service } = start();
      okData(await service.save(adoDraft));
      let finish: (outcome: ConnectionTestOutcome) => void = () => undefined;
      adoTester.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));

      const pending = service.test({ id: 'ado:companionsystems' });
      await vi.waitFor(() => expect(adoTester).toHaveBeenCalledOnce());
      clock += 1000;
      okData(await service.replace({ id: 'ado:companionsystems', draft: { ...adoDraft, pat: PAT_2 } }));
      finish({ status: 'error', identity: null, message: 'old token rejected' });

      expect(okData(await pending).status).toBe('error');
      expect(await service.get('ado:companionsystems')).toMatchObject({ status: 'untested', statusMessage: null, maskedToken: '••••••••Zx9K' });
    });

    it('refuses an unknown id', async () => {
      const { service } = start();
      await expect(service.test({ id: 'ado:nowhere' })).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
    });
  });

  describe('replace', () => {
    it('swaps the token and settings, keeping the id, creation time and default project', async () => {
      const { service } = start();
      okData(await service.save({ ...adoDraft, defaultProject: 'OnSite Companion', expiresAt: '2026-12-01' }));
      clock += 60_000;
      events.length = 0;

      const row = okData(await service.replace({ id: 'ado:companionsystems', draft: { ...adoDraft, pat: PAT_2 } }));
      expect(row).toMatchObject({
        id: 'ado:companionsystems',
        maskedToken: '••••••••Zx9K',
        defaultProject: 'OnSite Companion',
        expiresAt: null,
        status: 'untested',
        createdAt: '2026-10-07T03:00:00.000Z',
        updatedAt: '2026-10-07T03:01:00.000Z',
      });
      await expect(service.secret('ado:companionsystems')).resolves.toBe(PAT_2);
      expect(await secretsFileText()).not.toContain(PAT);
      expect(events).toEqual([{ channel: 'connections:changed', payload: {} }]);
    });

    it('reconnects a row whose token could not be read', async () => {
      const { service } = start();
      okData(await service.save(adoDraft));
      // Another machine's key: the saved token no longer decrypts.
      key = randomBytes(32);
      const restarted = start().service;
      expect(await restarted.get('ado:companionsystems')).toMatchObject({ needsReconnect: true, status: 'error', statusMessage: RECONNECT_MESSAGE });

      const row = okData(await restarted.replace({ id: 'ado:companionsystems', draft: adoDraft }));
      expect(row).toMatchObject({ needsReconnect: false, status: 'untested' });
      await expect(restarted.secret('ado:companionsystems')).resolves.toBe(PAT);
    });

    it('drops the API key when Claude switches to the Claude Code login', async () => {
      const { service, secrets } = start();
      okData(await service.save(claudeKeyDraft));
      const row = okData(await service.replace({ id: 'claude', draft: { kind: 'claude', mode: 'login' } }));

      expect(row).toMatchObject({ mode: 'login', maskedToken: null });
      await expect(secrets.list()).resolves.toEqual([]);
      await expect(service.sessionEnv()).resolves.toEqual({});
    });

    it('refuses another kind, an unknown id, or an organisation that is connected already', async () => {
      const { service } = start();
      okData(await service.save(adoDraft));
      okData(await service.save({ kind: 'ado', orgUrl: 'https://dev.azure.com/fabrikam', pat: OTHER_PAT }));

      expect(await service.replace({ id: 'ado:companionsystems', draft: claudeKeyDraft })).toMatchObject({ ok: false, code: 'VALIDATION' });
      expect(await service.replace({ id: 'ado:nowhere', draft: adoDraft })).toMatchObject({ ok: false, code: 'VALIDATION' });
      expect(await service.replace({ id: 'ado:companionsystems', draft: { kind: 'ado', orgUrl: 'https://dev.azure.com/Fabrikam', pat: PAT_2 } })).toMatchObject({
        ok: false,
        code: 'VALIDATION',
        details: { id: 'ado:fabrikam' },
      });
      await expect(service.secret('ado:companionsystems')).resolves.toBe(PAT);
    });

    it('puts the old token back when connections.json cannot be written', async () => {
      const { service } = start();
      okData(await service.save(adoDraft));
      file.failWrites = true;

      expect(await service.replace({ id: 'ado:companionsystems', draft: { ...adoDraft, pat: PAT_2 } })).toMatchObject({ ok: false, code: 'INTERNAL' });
      await expect(service.secret('ado:companionsystems')).resolves.toBe(PAT);
      expect(await service.get('ado:companionsystems')).toMatchObject({ maskedToken: '••••••••7Fq2' });
    });
  });

  describe('remove', () => {
    it('deletes the connection and its token', async () => {
      const { service, secrets } = start();
      okData(await service.save(adoDraft));
      events.length = 0;

      expect(okData(await service.remove('ado:companionsystems'))).toEqual({ id: 'ado:companionsystems', removed: true });
      await expect(service.list()).resolves.toEqual([]);
      await expect(secrets.list()).resolves.toEqual([]);
      await expect(service.secret('ado:companionsystems')).resolves.toBeUndefined();
      expect(await secretsFileText()).not.toContain('ado:companionsystems');
      expect(events).toEqual([{ channel: 'connections:changed', payload: {} }]);
    });

    it('takes the API key out of the env of every session launched afterwards, including after a restart', async () => {
      const { service } = start();
      okData(await service.save(claudeKeyDraft));
      await expect(service.sessionEnv()).resolves.toEqual({ ANTHROPIC_API_KEY: API_KEY });

      okData(await service.remove('claude'));
      await expect(service.sessionEnv()).resolves.toEqual({});

      const nextLaunch = start().service;
      await expect(nextLaunch.sessionEnv()).resolves.toEqual({});
      await expect(nextLaunch.list()).resolves.toEqual([]);
      expect(await secretsFileText()).not.toContain('claude:api-key');
    });

    it('treats removing twice as done', async () => {
      const { service } = start();
      okData(await service.save(adoDraft));
      okData(await service.remove('ado:companionsystems'));
      expect(okData(await service.remove('ado:companionsystems'))).toEqual({ id: 'ado:companionsystems', removed: false });
      expect(await service.remove('not an id')).toMatchObject({ ok: false, code: 'VALIDATION' });
    });

    it('keeps the connection when its token cannot be deleted', async () => {
      const real = openSecrets();
      const secrets: SecretStore = {
        ...real,
        delete: async () => {
          throw new SecretStoreError('WRITE_FAILED', 'Could not write secrets.json (EPERM).');
        },
      };
      const { service } = start({ secrets });
      okData(await service.save(adoDraft));

      expect(await service.remove('ado:companionsystems')).toMatchObject({ ok: false, code: 'INTERNAL', details: { secretStore: 'WRITE_FAILED' } });
      expect(await service.list()).toHaveLength(1);
      await expect(service.secret('ado:companionsystems')).resolves.toBe(PAT);
    });

    it('a token left behind by an interrupted remove is deleted on the next launch', async () => {
      const secrets = openSecrets();
      await secrets.put('ado:companionsystems', PAT);
      await secrets.put('design:canvas', 'not-a-connection-secret-0000');

      const { service } = start();
      await expect(service.list()).resolves.toEqual([]);
      expect((await openSecrets().list()).map((entry) => entry.id)).toEqual(['design:canvas']);
      expect(warnings).toEqual(['Deleted the token ado:companionsystems: no connection uses it.']);
    });
  });

  describe('start-up', () => {
    it('keeps every token when connections.json was corrupt, and says the connections are lost', async () => {
      await openSecrets().put('ado:companionsystems', PAT);
      file.unreadable = 'corrupt';

      const { service } = start();
      await expect(service.list()).resolves.toEqual([]);
      await expect(openSecrets().get('ado:companionsystems')).resolves.toBe(PAT);
      expect(warnings[0]).toMatch(/was corrupt; saved connections are lost/);
      // The file was set aside, so saving works again.
      expect(okData(await service.save(adoDraft)).id).toBe('ado:companionsystems');
    });

    it('drops a malformed record, keeps the others, and keeps every token', async () => {
      const { service } = start();
      okData(await service.save(adoDraft));
      okData(await service.save(claudeKeyDraft));
      const stored = file.contents as { connections: Array<Record<string, unknown>> };
      file = createMemoryConnectionsFile({ ...stored, connections: [{ ...stored.connections[0], status: 'great' }, stored.connections[1]] });

      const restarted = start().service;
      expect((await restarted.list()).map((row) => row.id)).toEqual(['claude']);
      await expect(openSecrets().get('ado:companionsystems')).resolves.toBe(PAT);
      expect(warnings).toEqual([expect.stringMatching(/Dropped 1 malformed connection record/)]);
    });

    it('refuses changes while connections.json cannot be read, and carries on once it can', async () => {
      const { service } = start();
      okData(await service.save(adoDraft));
      file.unreadable = 'io-error';

      const locked = start().service;
      await expect(locked.list()).resolves.toEqual([]);
      expect(await locked.save(claudeKeyDraft)).toMatchObject({ ok: false, code: 'INTERNAL' });
      expect(await locked.remove('ado:companionsystems')).toMatchObject({ ok: false, code: 'INTERNAL' });
      await expect(openSecrets().get('ado:companionsystems')).resolves.toBe(PAT);

      file.unreadable = null;
      okData(await locked.save(claudeKeyDraft));
      expect((await locked.list()).map((row) => row.id)).toEqual(['ado:companionsystems', 'claude']);
    });

    it('reports a corrupt secrets file as "reconnect" on the rows that lost their token', async () => {
      const { service } = start();
      okData(await service.save(adoDraft));
      okData(await service.save({ kind: 'claude', mode: 'login' }));
      await writeFile(join(dir, SECRETS_FILE_NAME), '{"version":1,"secrets":{"ado:companionsystems":{"ciphertext":');

      const restarted = start().service;
      const rows = await restarted.list();
      expect(rows.find((row) => row.id === 'ado:companionsystems')).toMatchObject({ needsReconnect: true, status: 'error', statusMessage: RECONNECT_MESSAGE });
      expect(rows.find((row) => row.id === 'claude')).toMatchObject({ needsReconnect: false, status: 'untested' });

      const retest = okData(await restarted.test({ id: 'ado:companionsystems' }));
      expect(retest).toMatchObject({ status: 'error', message: RECONNECT_MESSAGE });
      expect(adoTester).not.toHaveBeenCalled();
    });
  });

  it('never returns or announces a token, whatever happens (service-level spy)', async () => {
    const { service } = start({ testers: { ado: adoTester, claude: async () => ({ status: 'error', identity: null, message: `bad key ${API_KEY}` }) } });
    const seen: unknown[] = [];
    const call = async <T>(promise: Promise<T>) => {
      const value = await promise;
      seen.push(value);
      return value;
    };

    await call(service.test({ draft: adoDraft }));
    await call(service.save(adoDraft));
    await call(service.test({ draft: claudeKeyDraft }));
    await call(service.save(claudeKeyDraft));
    await call(service.save(mcpDraft));
    await call(service.save(adoDraft));
    await call(service.test({ id: 'ado:companionsystems' }));
    await call(service.test({ id: 'claude' }));
    await call(service.replace({ id: 'ado:companionsystems', draft: { ...adoDraft, pat: PAT_2 } }));
    await call(service.replace({ id: 'claude', draft: { ...claudeKeyDraft, apiKey: `${API_KEY}x` } }));
    await call(service.save({ ...adoDraft, orgUrl: 'nope' }));
    await call(service.list());
    await call(service.remove('mcp:github'));
    await call(service.list());

    expect(seen).toHaveLength(14);
    expectNoToken(seen);
    expectNoToken(events);
    expectNoToken(warnings);
  });
});
