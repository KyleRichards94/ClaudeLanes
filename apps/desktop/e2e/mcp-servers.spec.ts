import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { ConnectionSummary, ConnectionTestResult, Result } from '@agent-lanes/contracts';
import { startFakeMcpHttpServer, type FakeMcpHttpServer } from '../src/main/connections/testing';

/**
 * AL-045 against the real app: MCP servers are tested by really starting them from the main process
 * (a fake stdio server run with `node`, and a fake HTTP server on 127.0.0.1), their tokens go through
 * real IPC into the SecretStore on Electron's safeStorage, and nothing on disk outside secrets.json,
 * nor any IPC reply, holds a token. Nothing leaves the machine.
 */

/** Made up for this test; shaped like real tokens, valid nowhere. */
const STDIO_TOKEN = 'ghp_fakee2eStdio000000000000000000000Mcp1';
const HTTP_TOKEN = 'fake-e2e-http-token-0000-not-real-0000-Hd7Q';
const TOKENS = [STDIO_TOKEN, HTTP_TOKEN];

const FAKE_SERVER = join(__dirname, '..', 'src', 'main', 'connections', 'testing', 'fake-mcp-server.mjs');

function expectNoToken(label: string, value: unknown): void {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  for (const token of TOKENS) {
    for (const form of [token, Buffer.from(token).toString('base64'), encodeURIComponent(token)]) {
      expect(text, `${label} contains a token`).not.toContain(form);
    }
  }
}

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

let userDataDir: string;
let app: ElectronApplication | undefined;
let page: Page;
let http: FakeMcpHttpServer;
const replies: unknown[] = [];

async function launch(): Promise<void> {
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
}

async function invoke<T>(channel: string, payload?: unknown): Promise<Result<T>> {
  const reply = await page.evaluate(
    ([name, body]) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name, body),
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

/** Every file in the profile except secrets.json, where the encrypted tokens belong. */
function profileFilesOtherThanSecrets(): Array<{ name: string; text: string }> {
  const files: Array<{ name: string; text: string }> = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name !== 'secrets.json' && /\.(json|log|txt)$/.test(entry.name)) files.push({ name: path, text: readFileSync(path, 'utf8') });
    }
  };
  walk(userDataDir);
  return files;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-mcp-'));
  http = await startFakeMcpHttpServer({ requireHeader: { name: 'Authorization', value: `Bearer ${HTTP_TOKEN}` }, tools: ['search', 'fetch'] });
  await launch();
});

test.afterAll(async () => {
  await app?.close();
  await http?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('a server whose command fails to start shows its error output in the row', async () => {
  const draft = {
    kind: 'mcp',
    name: 'Broken server',
    transport: { type: 'stdio', command: 'node', args: [FAKE_SERVER, '--fail', 'fatal: could not read C:/nowhere/mcp-config.json', '--exit', '3'], envVar: null },
  };
  const tested = await data<ConnectionTestResult>('connections:test', { draft });
  expect(tested.status).toBe('error');
  expect(tested.message).toContain('stopped before it answered as an MCP server');
  expect(tested.message).toContain('fatal: could not read C:/nowhere/mcp-config.json');

  const saved = await data<ConnectionSummary>('connections:save', draft);
  expect(saved).toMatchObject({ id: 'mcp:broken-server', status: 'error', statusMessage: tested.message });

  // Testing the saved row again shows the same output, and the list carries it.
  expect(await data<ConnectionTestResult>('connections:test', { id: 'mcp:broken-server' })).toMatchObject({ status: 'error', message: tested.message });
  const row = (await data<ConnectionSummary[]>('connections:list')).find((item) => item.id === 'mcp:broken-server');
  expect(row).toMatchObject({ status: 'error', statusMessage: expect.stringContaining('fatal: could not read C:/nowhere/mcp-config.json') });

  // A command that doesn't exist says so.
  const missing = await data<ConnectionTestResult>('connections:test', {
    draft: { kind: 'mcp', name: 'Missing', transport: { type: 'stdio', command: 'agent-lanes-no-such-mcp-server-9c1e', args: [], envVar: null } },
  });
  expect(missing).toMatchObject({ status: 'error', message: expect.stringContaining('the command was not found') });
});

test('a working server is started, lists its tools, and gets its token from the SecretStore', async () => {
  const draft = {
    kind: 'mcp',
    name: 'Fake stdio',
    transport: { type: 'stdio', command: 'node', args: [FAKE_SERVER, '--report-env', 'FAKE_MCP_TOKEN'], envVar: 'FAKE_MCP_TOKEN' },
    token: STDIO_TOKEN,
  };
  const digest = createHash('sha256').update(STDIO_TOKEN).digest('hex').slice(0, 12);
  const tested = await data<ConnectionTestResult>('connections:test', { draft });
  expect(tested).toMatchObject({ status: 'ok', identity: 'fake-mcp 1.2.3', tools: ['echo', `env-FAKE_MCP_TOKEN-${digest}`] });

  const saved = await data<ConnectionSummary>('connections:save', draft);
  expect(saved).toMatchObject({ id: 'mcp:fake-stdio', status: 'ok', maskedToken: '••••••••Mcp1', tools: ['echo', `env-FAKE_MCP_TOKEN-${digest}`] });

  // Re-testing the saved server reads the token back out of the SecretStore (DPAPI round trip).
  expect(await data<ConnectionTestResult>('connections:test', { id: 'mcp:fake-stdio' })).toMatchObject({
    status: 'ok',
    tools: ['echo', `env-FAKE_MCP_TOKEN-${digest}`],
  });
});

test('an HTTP server gets its token in the header, and a wrong one is refused', async () => {
  const draft = { kind: 'mcp', name: 'Fake HTTP', transport: { type: 'http', url: `${http.origin}/mcp`, header: 'Authorization' }, token: HTTP_TOKEN };
  expect(await data<ConnectionTestResult>('connections:test', { draft })).toMatchObject({ status: 'ok', identity: 'fake-mcp-http 2.0.0', tools: ['search', 'fetch'] });
  expect(await data<ConnectionTestResult>('connections:test', { draft: { ...draft, token: 'fake-wrong-token-0000-0000-0000-0000' } })).toMatchObject({
    status: 'error',
    message: expect.stringContaining('HTTP 401'),
  });
  expect(await data<ConnectionSummary>('connections:save', draft)).toMatchObject({ id: 'mcp:fake-http', status: 'ok', maskedToken: '••••••••Hd7Q' });
  expect(http.requests.some((request) => request.authorized && request.method === 'POST')).toBe(true);
});

test('MCP tokens are stored in the SecretStore, never in settings or any other file, nor in a reply', async () => {
  // Make sure settings.json exists and has been written in this profile.
  expect((await invoke('settings:update', { buildQueueSize: 2 })).ok).toBe(true);
  expect(existsSync(join(userDataDir, 'settings.json'))).toBe(true);

  const secrets = JSON.parse(readFileSync(join(userDataDir, 'secrets.json'), 'utf8')) as { secrets: Record<string, unknown> };
  expect(Object.keys(secrets.secrets).sort()).toEqual(['mcp:fake-http', 'mcp:fake-stdio']);
  expectNoToken('secrets.json', readFileSync(join(userDataDir, 'secrets.json'), 'utf8'));

  const files = profileFilesOtherThanSecrets();
  expect(files.map((file) => file.name.replace(userDataDir, ''))).toEqual(expect.arrayContaining([expect.stringMatching(/settings\.json$/), expect.stringMatching(/connections\.json$/)]));
  for (const file of files) expectNoToken(file.name, file.text);
  expectNoToken('an invoke reply', replies);

  // Removing a server deletes its token.
  expect(await data('connections:remove', { id: 'mcp:fake-http' })).toEqual({ id: 'mcp:fake-http', removed: true });
  const after = JSON.parse(readFileSync(join(userDataDir, 'secrets.json'), 'utf8')) as { secrets: Record<string, unknown> };
  expect(Object.keys(after.secrets)).toEqual(['mcp:fake-stdio']);
});
