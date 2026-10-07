import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { ConnectionSummary, ConnectionTestResult, RemoveConnectionResult, Result } from '@agent-lanes/contracts';

/**
 * AL-042 against the real app: real IPC, the real SecretStore on Electron's safeStorage, and
 * connections.json in a throwaway profile. Azure DevOps is a fake on 127.0.0.1, so nothing leaves
 * the machine and no real token exists. A spy on both sides of IPC records every reply and every
 * event and fails the test if any of them holds a token.
 */

/** Made up for this test; shaped like real tokens, valid nowhere. */
const PAT = 'fakepat0000e2e1111only2222never3333real4444abcd7Fq2';
const PAT_2 = 'fakepat9999e2e8888token7777for6666replace5555Zx9K';
const WRONG_PAT = 'fakepat5555e2e6666wrong7777token8888for9999the0000x';
const API_KEY = 'sk-ant-e2e-0000-not-a-real-key-0000-Ab12';
const MCP_TOKEN = 'ghp_fakee2e00000000000000000000000000Mcp1';
const TOKENS = [PAT, PAT_2, WRONG_PAT, API_KEY, MCP_TOKEN];

/** Every way a token could be spelled on the wire. */
function tokenForms(token: string): string[] {
  return [token, Buffer.from(token).toString('base64'), Buffer.from(`:${token}`).toString('base64'), encodeURIComponent(token)];
}

function expectNoToken(label: string, value: unknown): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const token of TOKENS) {
    for (const form of tokenForms(token)) expect(text, `${label} contains a token`).not.toContain(form);
  }
}

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
}

interface RendererProbe {
  agentLanes: Bridge;
  connectionEvents: unknown[];
}

interface MainProbe {
  sentToRenderer?: string[];
}

// ---- a fake Azure DevOps organisation on loopback -------------------------------------------

let ado: Server;
let orgUrl: string;
const adoRequests: Array<{ path: string; authorized: boolean }> = [];

function startFakeAdo(): Promise<void> {
  const accepted = new Set([PAT, PAT_2].map((token) => `Basic ${Buffer.from(`:${token}`).toString('base64')}`));
  ado = createServer((request, response) => {
    const authorized = accepted.has(request.headers.authorization ?? '');
    adoRequests.push({ path: request.url ?? '', authorized });
    if (!request.url?.startsWith('/CompanionSystems/_apis/connectionData')) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(authorized ? 200 : 401, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify(
        authorized
          ? { authenticatedUser: { id: '6c3a2b1e-0000-4000-8000-000000000001', providerDisplayName: 'Kyle Richards' } }
          : { message: 'TF400813: The user is not authorized to access this resource.' },
      ),
    );
  });
  return new Promise((resolve) => {
    ado.listen(0, '127.0.0.1', () => {
      orgUrl = `http://127.0.0.1:${(ado.address() as AddressInfo).port}/CompanionSystems`;
      resolve();
    });
  });
}

// ---- the app ---------------------------------------------------------------------------------

let userDataDir: string;
let app: ElectronApplication | undefined;
let page: Page;
const replies: unknown[] = [];

async function launch(): Promise<void> {
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();

  // Main side: every message any frame is sent goes through WebFrameMain#send; record them all.
  await app.evaluate(({ BrowserWindow }) => {
    const probe = globalThis as MainProbe;
    probe.sentToRenderer = [];
    const frame = BrowserWindow.getAllWindows()[0]?.webContents.mainFrame;
    if (!frame) throw new Error('no main window');
    const owner = Object.prototype.hasOwnProperty.call(Object.getPrototypeOf(frame), 'send') ? Object.getPrototypeOf(frame) : frame;
    const original = owner.send as (this: unknown, channel: string, ...args: unknown[]) => void;
    owner.send = function send(this: unknown, channel: string, ...args: unknown[]) {
      probe.sentToRenderer?.push(JSON.stringify({ channel, args }));
      original.call(this, channel, ...args);
    };
  });

  // Renderer side: what actually arrives through the preload.
  await page.evaluate(() => {
    const probe = globalThis as unknown as RendererProbe;
    probe.connectionEvents = [];
    probe.agentLanes.on('connections:changed', (payload) => probe.connectionEvents.push(payload));
  });
}

async function close(): Promise<void> {
  await app?.close();
  app = undefined;
}

async function invoke<T>(channel: string, payload?: unknown): Promise<Result<T>> {
  const reply = await page.evaluate(
    ([name, body]) => (globalThis as unknown as RendererProbe).agentLanes.invoke(name, body),
    [channel, payload] as const,
  );
  replies.push({ channel, reply });
  return reply as Result<T>;
}

async function data<T>(channel: string, payload?: unknown): Promise<T> {
  const result = await invoke<T>(channel, payload);
  if (!result.ok) throw new Error(`${channel} failed: ${result.code} ${result.message}`);
  return result.data;
}

async function eventsSentToRenderer(): Promise<string[]> {
  return (await app?.evaluate(() => (globalThis as MainProbe).sentToRenderer ?? [])) ?? [];
}

function connectionEventCount(): Promise<number> {
  return page.evaluate(() => (globalThis as unknown as RendererProbe).connectionEvents.length);
}

function secretIdsOnDisk(): string[] {
  const file = JSON.parse(readFileSync(join(userDataDir, 'secrets.json'), 'utf8')) as { secrets: Record<string, unknown> };
  return Object.keys(file.secrets).sort();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-connections-'));
  await startFakeAdo();
  await launch();
});

test.afterAll(async () => {
  await close();
  await new Promise((resolve) => ado?.close(resolve));
  rmSync(userDataDir, { recursive: true, force: true });
});

test('no IPC reply or event carries a token (IPC spy)', async () => {
  expect(await data<ConnectionSummary[]>('connections:list')).toEqual([]);

  const draft = { kind: 'ado', orgUrl: `${orgUrl}/`, pat: PAT, defaultProject: 'OnSite Companion' };
  const wrong = await data<ConnectionTestResult>('connections:test', { draft: { ...draft, pat: WRONG_PAT } });
  expect(wrong).toMatchObject({ status: 'error', identity: null, message: expect.stringContaining('401') });

  const tested = await data<ConnectionTestResult>('connections:test', { draft });
  expect(tested).toMatchObject({ status: 'ok', identity: 'Kyle Richards' });

  const saved = await data<ConnectionSummary>('connections:save', draft);
  expect(saved).toMatchObject({
    id: 'ado:companionsystems',
    kind: 'ado',
    name: 'CompanionSystems',
    orgUrl,
    defaultProject: 'OnSite Companion',
    identity: 'Kyle Richards',
    maskedToken: '••••••••7Fq2',
    status: 'ok',
    needsReconnect: false,
  });

  expect(await data<ConnectionSummary>('connections:save', { kind: 'claude', mode: 'api-key', apiKey: API_KEY })).toMatchObject({
    id: 'claude',
    maskedToken: '••••••••Ab12',
    status: 'untested',
  });
  expect(
    await data<ConnectionSummary>('connections:save', {
      kind: 'mcp',
      name: 'GitHub',
      transport: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'], envVar: 'GITHUB_PERSONAL_ACCESS_TOKEN' },
      token: MCP_TOKEN,
    }),
  ).toMatchObject({ id: 'mcp:github', maskedToken: '••••••••Mcp1' });

  // A duplicate is refused without echoing what was sent.
  const duplicate = await invoke('connections:save', { ...draft, pat: PAT_2 });
  expect(duplicate).toMatchObject({ ok: false, code: 'VALIDATION' });

  expect(await data<ConnectionTestResult>('connections:test', { id: 'ado:companionsystems' })).toMatchObject({ status: 'ok' });
  expect(await data<ConnectionSummary>('connections:replace', { id: 'ado:companionsystems', draft: { ...draft, pat: PAT_2 } })).toMatchObject({
    maskedToken: '••••••••Zx9K',
    createdAt: saved.createdAt,
  });
  expect(await data<ConnectionTestResult>('connections:test', { id: 'ado:companionsystems' })).toMatchObject({ status: 'ok', identity: 'Kyle Richards' });

  const rows = await data<ConnectionSummary[]>('connections:list');
  expect(rows.map((row) => [row.id, row.maskedToken, row.status])).toEqual([
    ['ado:companionsystems', '••••••••Zx9K', 'ok'],
    ['claude', '••••••••Ab12', 'untested'],
    ['mcp:github', '••••••••Mcp1', 'untested'],
  ]);

  // Save ×3, test of a saved row ×2, replace: one connections:changed each, through the preload.
  await expect.poll(connectionEventCount).toBe(6);

  // The tokens did reach the fake Azure DevOps (only it), so the spy below is checking real traffic.
  expect(adoRequests.filter((request) => request.authorized)).toHaveLength(3);
  expect(adoRequests.filter((request) => !request.authorized)).toHaveLength(1);

  const sent = await eventsSentToRenderer();
  expect(sent.some((message) => message.includes('"connections:changed"'))).toBe(true);
  expectNoToken('an event sent to the renderer', sent);
  expectNoToken('an invoke reply', replies);
  expectNoToken('connections.json', readFileSync(join(userDataDir, 'connections.json'), 'utf8'));
  expectNoToken('secrets.json', readFileSync(join(userDataDir, 'secrets.json'), 'utf8'));
  expect(secretIdsOnDisk()).toEqual(['ado:companionsystems', 'claude:api-key', 'mcp:github']);
});

test('remove deletes the token, and it stays gone on the next launch', async () => {
  test.slow(); // a relaunch
  expect(await data<RemoveConnectionResult>('connections:remove', { id: 'claude' })).toEqual({ id: 'claude', removed: true });
  expect(secretIdsOnDisk()).toEqual(['ado:companionsystems', 'mcp:github']);
  expect((await data<ConnectionSummary[]>('connections:list')).map((row) => row.id)).toEqual(['ado:companionsystems', 'mcp:github']);

  await close();
  await launch();

  const rows = await data<ConnectionSummary[]>('connections:list');
  expect(rows.map((row) => [row.id, row.maskedToken, row.status, row.needsReconnect])).toEqual([
    ['ado:companionsystems', '••••••••Zx9K', 'ok', false],
    ['mcp:github', '••••••••Mcp1', 'untested', false],
  ]);
  expect(secretIdsOnDisk()).toEqual(['ado:companionsystems', 'mcp:github']);

  // The token saved before the restart still works (DPAPI round trip through the real safeStorage).
  expect(await data<ConnectionTestResult>('connections:test', { id: 'ado:companionsystems' })).toMatchObject({ status: 'ok' });

  expect(await data<RemoveConnectionResult>('connections:remove', { id: 'ado:companionsystems' })).toEqual({ id: 'ado:companionsystems', removed: true });
  expect(await data<RemoveConnectionResult>('connections:remove', { id: 'mcp:github' })).toEqual({ id: 'mcp:github', removed: true });
  expect(secretIdsOnDisk()).toEqual([]);
  expect(await data<ConnectionSummary[]>('connections:list')).toEqual([]);
  expect(existsSync(join(userDataDir, 'connections.json'))).toBe(true);

  expectNoToken('an event sent to the renderer', await eventsSentToRenderer());
  expectNoToken('an invoke reply', replies);
});

test('a corrupt connections.json is set aside, its tokens are kept, and saving works again', async () => {
  test.slow(); // a relaunch
  expect(await data<ConnectionSummary>('connections:save', { kind: 'ado', orgUrl, pat: PAT })).toMatchObject({ id: 'ado:companionsystems' });
  await close();

  const garbage = '{"version":1,"connections":[{"kind":"ado",';
  writeFileSync(join(userDataDir, 'connections.json'), garbage);
  await launch();

  expect(await data<ConnectionSummary[]>('connections:list')).toEqual([]);
  const backups = readdirSync(userDataDir).filter((name) => /^connections\.corrupt-.+\.json$/.test(name));
  expect(backups).toHaveLength(1);
  expect(readFileSync(join(userDataDir, backups[0] ?? ''), 'utf8')).toBe(garbage);
  // Records are lost, but a damaged file never costs the user a token.
  expect(secretIdsOnDisk()).toEqual(['ado:companionsystems']);

  expect(await data<ConnectionSummary>('connections:save', { kind: 'ado', orgUrl, pat: PAT })).toMatchObject({ id: 'ado:companionsystems' });
  expect(await data<ConnectionTestResult>('connections:test', { id: 'ado:companionsystems' })).toMatchObject({ status: 'ok' });
  expectNoToken('connections.json', readFileSync(join(userDataDir, 'connections.json'), 'utf8'));
});
