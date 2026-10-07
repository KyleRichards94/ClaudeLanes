import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConnectionSummarySchema, ConnectionTestResultSchema, MCP_TOOLS_LIMIT, type EventChannel } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { SECRETS_FILE_NAME, createSecretStore, type SecretStore } from '../secrets';
import { createFakeSafeStorage } from '../secrets/testing';
import { adoMcpServerFor } from './ado-mcp';
import { createMemoryConnectionsFile, type MemoryConnectionsFile } from './connections-file';
import { createMcpConnectionTester } from './mcp-tester';
import { RECONNECT_MESSAGE, createConnectionsService } from './service';
import type { ConnectionTestOutcome, ConnectionTesters, DraftOf } from './testers';

/**
 * AL-045: MCP server entries in the connections service: tokens in the SecretStore only, the test
 * outcome (error output or tools) on the row, the built-in Azure DevOps server per organisation, and
 * the session configs AL-108 hands to the Agent SDK.
 */

/** Made up for these tests; shaped like real tokens, valid nowhere. */
const PAT = 'fakepat0000test1111only2222never3333real4444abcd7Fq2';
const PAT_2 = 'fakepat9999second8888token7777for6666replace5555Zx9K';
const MCP_TOKEN = 'ghp_fakeService00000000000000000000Mcp1';
const ALL_TOKENS = [PAT, PAT_2, MCP_TOKEN];

const FAKE_SERVER = fileURLToPath(new URL('./testing/fake-mcp-server.mjs', import.meta.url));
const ORG_URL = 'https://dev.azure.com/CompanionSystems';
const adoDraft = { kind: 'ado', orgUrl: ORG_URL, pat: PAT } as const;
const githubDraft = {
  kind: 'mcp' as const,
  name: 'GitHub',
  transport: { type: 'stdio' as const, command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], envVar: 'GITHUB_PERSONAL_ACCESS_TOKEN' },
  token: MCP_TOKEN,
};
const docsDraft = { kind: 'mcp' as const, name: 'Docs', transport: { type: 'http' as const, url: 'https://mcp.example.test/mcp', header: 'Authorization' }, token: MCP_TOKEN };
const BUILT_IN_ID = 'mcp:ado.companionsystems';

let dir: string;
let key: Buffer;
let file: MemoryConnectionsFile;
let events: Array<{ channel: EventChannel; payload: unknown }>;
let mcpTester: Mock<(draft: DraftOf<'mcp'>, signal: AbortSignal) => Promise<ConnectionTestOutcome>>;
let clock: number;

function openSecrets(): SecretStore {
  return createSecretStore({ filePath: join(dir, SECRETS_FILE_NAME), safeStorage: createFakeSafeStorage({ key }), warn: () => undefined });
}

function start(options: { testers?: ConnectionTesters; builtIns?: boolean; platform?: NodeJS.Platform } = {}) {
  const secrets = openSecrets();
  const service = createConnectionsService({
    file,
    secrets,
    emit: (channel, payload) => events.push({ channel, payload }),
    testers: options.testers ?? { ado: async () => ({ status: 'ok', identity: 'Kyle Richards', message: null }), mcp: mcpTester },
    ...(options.builtIns === false ? {} : { adoMcpServer: adoMcpServerFor }),
    platform: options.platform ?? 'linux',
    now: () => new Date(clock),
    warn: () => undefined,
  });
  return { service, secrets };
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
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-mcp-connections-'));
  key = randomBytes(32);
  file = createMemoryConnectionsFile();
  events = [];
  clock = Date.parse('2026-10-07T03:00:00.000Z');
  mcpTester = vi.fn(async (): Promise<ConnectionTestOutcome> => ({ status: 'ok', identity: 'github-mcp-server 0.5.0', message: null, tools: ['search_issues', 'get_issue'] }));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('MCP server tokens', () => {
  it('go into the SecretStore, never into connections.json, and come back only to main services', async () => {
    const { service } = start();
    const row = okData(await service.save(githubDraft));

    expect(row).toMatchObject({ id: 'mcp:github', kind: 'mcp', maskedToken: '••••••••Mcp1', transport: githubDraft.transport });
    expectNoToken(row);
    expectNoToken(file.contents);
    expect(file.contents).toMatchObject({ connections: [{ id: 'mcp:github', secretId: 'mcp:github' }] });

    const secretsFile = await readFile(join(dir, SECRETS_FILE_NAME), 'utf8');
    expect(secretsFile).not.toContain(MCP_TOKEN);
    expect(Object.keys((JSON.parse(secretsFile) as { secrets: object }).secrets)).toEqual(['mcp:github']);
    await expect(service.secret('mcp:github')).resolves.toBe(MCP_TOKEN);
  });

  it('are deleted with the server, and with the old settings when it no longer takes one', async () => {
    const { service, secrets } = start();
    okData(await service.save(githubDraft));
    const edited = okData(
      await service.replace({ id: 'mcp:github', draft: { kind: 'mcp', name: 'GitHub', transport: { ...githubDraft.transport, envVar: null } } }),
    );
    expect(edited).toMatchObject({ id: 'mcp:github', maskedToken: null });
    await expect(secrets.list()).resolves.toEqual([]);

    okData(await service.save(docsDraft));
    expect((await secrets.list()).map((entry) => entry.id)).toEqual(['mcp:docs']);
    okData(await service.remove('mcp:docs'));
    await expect(secrets.list()).resolves.toEqual([]);
  });
});

describe('MCP server test outcome on the row', () => {
  it('shows the error output of a server whose command fails to start', async () => {
    const { service } = start({ testers: { mcp: createMcpConnectionTester({ timeoutMs: 15_000 }) } });
    const failing = {
      kind: 'mcp' as const,
      name: 'Broken',
      transport: { type: 'stdio' as const, command: process.execPath, args: [FAKE_SERVER, '--fail', 'fatal: GITHUB_PERSONAL_ACCESS_TOKEN rejected'], envVar: null },
    };

    const tested = okData(await service.test({ draft: failing }));
    expect(tested).toMatchObject({ status: 'error', message: expect.stringContaining('fatal: GITHUB_PERSONAL_ACCESS_TOKEN rejected') });
    expect(ConnectionTestResultSchema.parse(tested)).toEqual(tested);

    // Saved right after the test: the row carries the error output.
    const row = okData(await service.save(failing));
    expect(row).toMatchObject({ status: 'error', statusMessage: tested.message });

    // Fixed with Replace and tested again: the row is green and lists the tools.
    clock += 60_000;
    okData(await service.replace({ id: row.id, draft: { ...failing, transport: { ...failing.transport, args: [FAKE_SERVER] } } }));
    expect(okData(await service.test({ id: row.id }))).toMatchObject({ status: 'ok', identity: 'fake-mcp 1.2.3', tools: ['echo'] });
    expect(await service.get(row.id)).toMatchObject({ status: 'ok', statusMessage: null, identity: 'fake-mcp 1.2.3', tools: ['echo'] });
  });

  it('keeps the tools a passing test listed across a restart, and drops them when a test fails', async () => {
    const { service } = start();
    okData(await service.save(githubDraft));
    okData(await service.test({ id: 'mcp:github' }));
    expect(events.filter((event) => event.channel === 'connections:changed')).toHaveLength(2);

    const restarted = start().service;
    expect(await restarted.get('mcp:github')).toMatchObject({ status: 'ok', identity: 'github-mcp-server 0.5.0', tools: ['search_issues', 'get_issue'] });

    mcpTester.mockResolvedValueOnce({ status: 'error', identity: null, message: `spawn failed, token ${MCP_TOKEN}` });
    const failed = okData(await restarted.test({ id: 'mcp:github' }));
    expect(failed).toMatchObject({ status: 'error', message: 'spawn failed, token ••••••••' });
    const row = await restarted.get('mcp:github');
    expect(row).toMatchObject({ status: 'error', statusMessage: 'spawn failed, token ••••••••', identity: 'github-mcp-server 0.5.0' });
    expect(row).not.toHaveProperty('tools');
  });

  it('caps and cleans the tool list so the row fits the contract', async () => {
    mcpTester.mockResolvedValueOnce({
      status: 'ok',
      identity: null,
      message: null,
      tools: ['', 'x'.repeat(300), `leaks_${MCP_TOKEN}`, ...Array.from({ length: 400 }, (_, index) => `tool_${index}`)],
    });
    const { service } = start();
    const tested = okData(await service.test({ draft: githubDraft }));
    expect(tested.tools).toHaveLength(MCP_TOOLS_LIMIT);
    expect(tested.tools?.[0]).toHaveLength(128);
    expect(tested.tools?.[1]).toBe('leaks_••••••••');
    expect(ConnectionTestResultSchema.parse(tested)).toEqual(tested);
    expect(ConnectionSummarySchema.parse(okData(await service.save(githubDraft)))).toMatchObject({ tools: tested.tools });
  });
});

describe('built-in Azure DevOps MCP server', () => {
  it('comes with each Azure DevOps Services organisation, first among the MCP servers', async () => {
    const { service } = start();
    okData(await service.save(githubDraft));
    okData(await service.save({ kind: 'claude', mode: 'login' }));
    okData(await service.save(adoDraft));
    okData(await service.save({ kind: 'ado', orgUrl: 'https://tfs.fabrikam.test/tfs/DefaultCollection', pat: PAT_2 }));

    const rows = await service.list();
    expect(rows.map((row) => [row.id, row.name])).toEqual([
      ['ado:companionsystems', 'CompanionSystems'],
      ['ado:defaultcollection', 'DefaultCollection'],
      ['claude', 'Claude'],
      [BUILT_IN_ID, 'Azure DevOps (CompanionSystems)'],
      ['mcp:github', 'GitHub'],
    ]);
    expect(rows[3]).toEqual({
      kind: 'mcp',
      id: BUILT_IN_ID,
      name: 'Azure DevOps (CompanionSystems)',
      builtInFor: 'ado:companionsystems',
      transport: { type: 'stdio', command: 'npx', args: ['-y', '@azure-devops/mcp', 'CompanionSystems', '--authentication', 'pat'], envVar: 'PERSONAL_ACCESS_TOKEN' },
      identity: null,
      maskedToken: '••••••••7Fq2',
      expiresAt: null,
      status: 'untested',
      statusMessage: null,
      needsReconnect: false,
      lastTestedAt: null,
      createdAt: '2026-10-07T03:00:00.000Z',
      updatedAt: '2026-10-07T03:00:00.000Z',
    });
    expect(await service.get(BUILT_IN_ID)).toEqual(rows[3]);
    // Derived, never stored: connections.json has the organisation only.
    expect((file.contents as { connections: Array<{ id: string }> }).connections.map((record) => record.id)).not.toContain(BUILT_IN_ID);
  });

  it('is only there when the app asks for it', async () => {
    const { service } = start({ builtIns: false });
    okData(await service.save(adoDraft));
    expect((await service.list()).map((row) => row.id)).toEqual(['ado:companionsystems']);
  });

  it('is tested with the organisation’s PAT as its credential, and the row shows the outcome', async () => {
    mcpTester.mockResolvedValueOnce({ status: 'ok', identity: 'Azure DevOps MCP Server 2.2.0', message: null, tools: ['wit_get_work_item', 'wit_add_work_item_comment'] });
    const { service } = start();
    okData(await service.save(adoDraft));
    events = [];

    clock += 60_000;
    const tested = okData(await service.test({ id: BUILT_IN_ID }));
    expect(tested).toMatchObject({ status: 'ok', identity: 'Azure DevOps MCP Server 2.2.0', tools: ['wit_get_work_item', 'wit_add_work_item_comment'] });
    expect(mcpTester).toHaveBeenCalledWith(
      {
        kind: 'mcp',
        name: 'Azure DevOps (CompanionSystems)',
        transport: expect.objectContaining({ command: 'npx', envVar: 'PERSONAL_ACCESS_TOKEN' }),
        token: Buffer.from(`:${PAT}`).toString('base64'),
      },
      expect.any(AbortSignal),
    );
    expect(events).toEqual([{ channel: 'connections:changed', payload: {} }]);
    expect(await service.get(BUILT_IN_ID)).toMatchObject({ status: 'ok', identity: 'Azure DevOps MCP Server 2.2.0', lastTestedAt: '2026-10-07T03:01:00.000Z' });

    // A new PAT makes the earlier outcome stale.
    okData(await service.replace({ id: 'ado:companionsystems', draft: { ...adoDraft, pat: PAT_2 } }));
    expect(await service.get(BUILT_IN_ID)).toMatchObject({ status: 'untested', maskedToken: '••••••••Zx9K', identity: null });
  });

  it('scrubs the PAT, in any form, from what its test reports', async () => {
    const credential = Buffer.from(`:${PAT}`).toString('base64');
    mcpTester.mockResolvedValueOnce({ status: 'error', identity: null, message: `401 for ${PAT} (${credential})` });
    const { service } = start();
    okData(await service.save(adoDraft));
    const tested = okData(await service.test({ id: BUILT_IN_ID }));
    expect(tested.message).toBe('401 for •••••••• (••••••••)');
    expectNoToken(await service.list());
  });

  it("can't be replaced or removed on its own, and goes with its organisation", async () => {
    const { service, secrets } = start();
    okData(await service.save(adoDraft));

    expect(await service.remove(BUILT_IN_ID)).toMatchObject({ ok: false, code: 'VALIDATION', details: { id: BUILT_IN_ID, builtInFor: 'ado:companionsystems' } });
    expect(await service.replace({ id: BUILT_IN_ID, draft: githubDraft })).toMatchObject({ ok: false, code: 'VALIDATION', details: { builtInFor: 'ado:companionsystems' } });
    await expect(service.secret('ado:companionsystems')).resolves.toBe(PAT);

    okData(await service.remove('ado:companionsystems'));
    expect(await service.list()).toEqual([]);
    await expect(secrets.list()).resolves.toEqual([]);
    expect(await service.test({ id: BUILT_IN_ID })).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('keeps its name and id from user servers', async () => {
    const { service } = start();
    okData(await service.save(adoDraft));
    expect(await service.save({ ...githubDraft, name: 'azure devops (companionsystems)' })).toMatchObject({ ok: false, code: 'VALIDATION', details: { id: BUILT_IN_ID } });
    expect(okData(await service.save({ ...githubDraft, name: 'ado.companionsystems' })).id).toBe('mcp:ado.companionsystems-2');
    expect((await service.list()).filter((row) => row.kind === 'mcp').map((row) => row.id)).toEqual([BUILT_IN_ID, 'mcp:ado.companionsystems-2']);
  });

  it('asks for a reconnect when the organisation’s PAT can’t be read', async () => {
    const { service, secrets } = start();
    okData(await service.save(adoDraft));
    await secrets.delete('ado:companionsystems');

    expect(await service.get(BUILT_IN_ID)).toMatchObject({ status: 'error', needsReconnect: true, statusMessage: RECONNECT_MESSAGE });
    expect(okData(await service.test({ id: BUILT_IN_ID }))).toMatchObject({ status: 'error', message: RECONNECT_MESSAGE });
    expect(mcpTester).not.toHaveBeenCalled();
  });
});

describe('session MCP servers (for AL-108)', () => {
  it('fills in each token at launch: env var for stdio, header for HTTP, the PAT credential for Azure DevOps', async () => {
    const { service } = start();
    okData(await service.save(adoDraft));
    okData(await service.save(githubDraft));
    okData(await service.save(docsDraft));
    okData(await service.save({ kind: 'mcp', name: 'Local', transport: { type: 'stdio', command: 'node', args: ['server.js'], envVar: null } }));

    expect(await service.sessionMcpServers({ adoConnectionId: 'ado:companionsystems' })).toEqual({
      servers: {
        'azure-devops': {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@azure-devops/mcp', 'CompanionSystems', '--authentication', 'pat'],
          env: { PERSONAL_ACCESS_TOKEN: Buffer.from(`:${PAT}`).toString('base64') },
        },
        docs: { type: 'http', url: 'https://mcp.example.test/mcp', headers: { Authorization: `Bearer ${MCP_TOKEN}` } },
        github: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], env: { GITHUB_PERSONAL_ACCESS_TOKEN: MCP_TOKEN } },
        local: { type: 'stdio', command: 'node', args: ['server.js'], env: {} },
      },
      unavailable: [],
    });
  });

  it('adds the Azure DevOps server only for the work item’s organisation', async () => {
    const { service } = start();
    okData(await service.save(adoDraft));
    expect(await service.sessionMcpServers()).toEqual({ servers: {}, unavailable: [] });
    expect(await service.sessionMcpServers({ adoConnectionId: 'ado:other' })).toEqual({ servers: {}, unavailable: [] });
  });

  it('starts npx through cmd /c on Windows', async () => {
    const { service } = start({ platform: 'win32' });
    okData(await service.save(adoDraft));
    const { servers } = await service.sessionMcpServers({ adoConnectionId: 'ado:companionsystems' });
    expect(servers['azure-devops']).toMatchObject({ command: 'cmd', args: ['/c', 'npx', '-y', '@azure-devops/mcp', 'CompanionSystems', '--authentication', 'pat'] });
  });

  it('leaves out a server whose token can’t be read, and never reuses a reserved name', async () => {
    const { service, secrets } = start();
    okData(await service.save(adoDraft));
    okData(await service.save(githubDraft));
    okData(await service.save({ kind: 'mcp', name: 'Azure DevOps', transport: { type: 'stdio', command: 'node', args: ['mine.js'], envVar: null } }));
    await secrets.delete('mcp:github');
    await secrets.delete('ado:companionsystems');

    expect(await service.sessionMcpServers({ adoConnectionId: 'ado:companionsystems' })).toEqual({
      servers: { 'azure-devops-2': { type: 'stdio', command: 'node', args: ['mine.js'], env: {} } },
      unavailable: [
        { id: BUILT_IN_ID, name: 'Azure DevOps (CompanionSystems)', reason: RECONNECT_MESSAGE },
        { id: 'mcp:github', name: 'GitHub', reason: RECONNECT_MESSAGE },
      ],
    });
  });
});
