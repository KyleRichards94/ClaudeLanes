import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { ConnectionSummary, ConnectionTestResult, Result } from '@agent-lanes/contracts';

/**
 * AL-043 against the real app: `connections:test` goes through real IPC to the main process, whose
 * ADO client talks to a fake Azure DevOps organisation on 127.0.0.1 (nothing leaves the machine,
 * no real token exists). The fake answers connectionData, a two-page project list and the three
 * scope probes, and refuses the Build probe for a PAT made without Build (read).
 */

/** Made up for this test; shaped like real PATs, valid nowhere. */
const PAT_ALL_SCOPES = 'fakepat0000e2e1111all2222scopes3333here4444okay0All';
const PAT_NO_BUILD = 'fakepat5555e2e6666no7777build8888scope9999here0Bd01';
const TOKENS = [PAT_ALL_SCOPES, PAT_NO_BUILD];

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

// ---- a fake Azure DevOps organisation on loopback -------------------------------------------

let ado: Server;
let orgUrl: string;
const adoRequests: Array<{ method: string; path: string }> = [];

function basic(token: string): string {
  return `Basic ${Buffer.from(`:${token}`).toString('base64')}`;
}

function send(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(body));
}

const TF400813 = { message: 'TF400813: The user is not authorized to access this resource.' };

function handle(request: IncomingMessage, response: ServerResponse): void {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  adoRequests.push({ method: request.method ?? 'GET', path: `${url.pathname}${url.search}` });
  const auth = request.headers.authorization ?? '';
  const token = TOKENS.find((candidate) => basic(candidate) === auth);
  if (!token) return send(response, 401, TF400813);

  const path = decodeURIComponent(url.pathname);
  if (path === '/CompanionSystems/_apis/connectionData') {
    return send(response, 200, { authenticatedUser: { id: '6c3a2b1e-0000-4000-8000-000000000001', providerDisplayName: 'Kyle Richards' } });
  }
  if (path === '/CompanionSystems/_apis/projects') {
    // Two pages, the way ADO pages projects: a continuation token in a header.
    return url.searchParams.get('continuationToken') === '2'
      ? send(response, 200, { count: 1, value: [{ name: 'Hicora' }] })
      : send(response, 200, { count: 1, value: [{ name: 'OnSite Companion' }] }, { 'x-ms-continuationtoken': '2' });
  }
  const probe = /^\/CompanionSystems\/[^/]+\/_apis\/(wit\/wiql|git\/repositories|build\/builds)$/.exec(path)?.[1];
  if (probe === 'wit/wiql' && request.method === 'POST') return send(response, 200, { queryType: 'flat', workItems: [] });
  if (probe === 'git/repositories') return send(response, 200, { count: 1, value: [{ id: 'r1', name: 'OnSiteCompanion' }] });
  if (probe === 'build/builds') return token === PAT_NO_BUILD ? send(response, 401, TF400813) : send(response, 200, { count: 0, value: [] });
  return send(response, 404, { message: 'Not found' });
}

function startFakeAdo(): Promise<void> {
  ado = createServer(handle);
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

async function data<T>(channel: string, payload?: unknown): Promise<T> {
  const reply = (await page.evaluate(
    ([name, body]) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name, body),
    [channel, payload] as const,
  )) as Result<T>;
  replies.push(reply);
  if (!reply.ok) throw new Error(`${channel} failed: ${reply.code} ${reply.message}`);
  return reply.data;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-ado-test-'));
  await startFakeAdo();
  app = await electron.launch({ args: [join(__dirname, '..')], env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir } });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await new Promise((resolve) => ado?.close(resolve));
  rmSync(userDataDir, { recursive: true, force: true });
});

test('a PAT without Build (read) signs in, loads the projects and shows Build missing', async () => {
  const tested = await data<ConnectionTestResult>('connections:test', {
    draft: { kind: 'ado', orgUrl, pat: PAT_NO_BUILD, defaultProject: 'OnSite Companion' },
  });

  expect(tested).toMatchObject({
    status: 'ok',
    identity: 'Kyle Richards',
    message: null,
    missingScopes: ['build'],
    projects: ['Hicora', 'OnSite Companion'],
    scopes: [
      { scope: 'work-items', access: 'read', status: 'granted' },
      { scope: 'work-items', access: 'write', status: 'unverified' },
      { scope: 'code', access: 'read', status: 'granted' },
      { scope: 'code', access: 'write', status: 'unverified' },
      { scope: 'build', access: 'read', status: 'missing' },
    ],
  });
  // The probes ran in the default project, and only read.
  const probes = adoRequests.filter((request) => /\/_apis\/(wit|git|build)\//.test(request.path));
  expect(probes.map((request) => request.path.split('?')[0]).toSorted()).toEqual([
    '/CompanionSystems/OnSite%20Companion/_apis/build/builds',
    '/CompanionSystems/OnSite%20Companion/_apis/git/repositories',
    '/CompanionSystems/OnSite%20Companion/_apis/wit/wiql',
  ]);
  expect(probes.filter((request) => request.method !== 'GET').map((request) => request.path.split('?')[0])).toEqual([
    '/CompanionSystems/OnSite%20Companion/_apis/wit/wiql',
  ]);
});

test('a PAT with every scope shows none missing', async () => {
  const tested = await data<ConnectionTestResult>('connections:test', { draft: { kind: 'ado', orgUrl, pat: PAT_ALL_SCOPES } });
  expect(tested).toMatchObject({ status: 'ok', identity: 'Kyle Richards', missingScopes: [], projects: ['Hicora', 'OnSite Companion'] });
});

test('the saved row is signed in as the user, with the masked token, the expiry and the missing scope', async () => {
  const draft = { kind: 'ado', orgUrl, pat: PAT_NO_BUILD, defaultProject: 'OnSite Companion', expiresAt: '2027-01-12' };
  await data<ConnectionTestResult>('connections:test', { draft });
  const saved = await data<ConnectionSummary>('connections:save', draft);

  const expected = {
    id: 'ado:companionsystems',
    kind: 'ado',
    name: 'CompanionSystems',
    orgUrl,
    defaultProject: 'OnSite Companion',
    identity: 'Kyle Richards',
    maskedToken: '••••••••Bd01',
    expiresAt: '2027-01-12',
    status: 'ok',
    missingScopes: ['build'],
    needsReconnect: false,
  };
  expect(saved).toMatchObject(expected);
  expect(await data<ConnectionSummary[]>('connections:list')).toEqual([expect.objectContaining(expected)]);

  // Re-testing the saved row keeps the result and loads the projects again.
  expect(await data<ConnectionTestResult>('connections:test', { id: 'ado:companionsystems' })).toMatchObject({
    status: 'ok',
    missingScopes: ['build'],
    projects: ['Hicora', 'OnSite Companion'],
  });

  // No reply and no file holds a token.
  const files = [readFileSync(join(userDataDir, 'connections.json'), 'utf8'), readFileSync(join(userDataDir, 'secrets.json'), 'utf8')];
  for (const token of TOKENS) {
    for (const form of [token, Buffer.from(`:${token}`).toString('base64')]) {
      expect(JSON.stringify(replies)).not.toContain(form);
      for (const file of files) expect(file).not.toContain(form);
    }
  }
});
