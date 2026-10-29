import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { ConnectionSummary, PeerNetworkStatus, Result } from '@agent-lanes/contracts';
import { createTestPeer, freePort, type TestPeer } from '../src/main/peers/testing';

/**
 * AL-289 against the real app: Connections › Peers saves a port, a team secret and a peer list. Test
 * dials fake peers started here on loopback (one with the same secret, one with another, and a port
 * nobody listens on). Saving starts the listener; a new port restarts it without restarting the app.
 * The secret goes into the SecretStore and comes back in no IPC reply and no other file.
 */

/** Made up for this test. */
const SECRET = 'e2e-team-secret-made-up-0000-Tq7V';

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

let userDataDir: string;
let app: ElectronApplication | undefined;
let page: Page;
let appPort: number;
let kyle: TestPeer;
let rocky: TestPeer;
let nobody: number;
const replies: string[] = [];

async function openPeersTab(): Promise<void> {
  await page.getByTestId('open-connections').click();
  await page.getByRole('tab', { name: /Peers/ }).click();
}

async function data<T>(channel: string): Promise<T> {
  const reply = (await page.evaluate((name) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name), channel)) as Result<T>;
  replies.push(JSON.stringify(reply));
  if (!reply.ok) throw new Error(`${channel} failed: ${reply.message}`);
  return reply.data;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-peers-'));
  appPort = await freePort();
  kyle = createTestPeer('kyle', await freePort());
  rocky = createTestPeer('rocky', await freePort());
  nobody = await freePort();
  await kyle.network.configure({ port: kyle.port, secret: SECRET, peers: [`localhost:${appPort}`] });
  await rocky.network.configure({ port: rocky.port, secret: 'another-team-entirely', peers: [`localhost:${appPort}`] });
  app = await electron.launch({ args: [join(__dirname, '..')], env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir } });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await kyle?.network.dispose();
  await rocky?.network.dispose();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('Test names who answered, who could not be reached and who signs with another secret; Save starts the listener', async () => {
  await openPeersTab();
  await page.getByTestId('peers-port').fill(String(appPort));
  await page.getByTestId('peers-secret').fill(SECRET);
  await page.getByTestId('peers-address-0').fill(`localhost:${kyle.port}`);
  await page.getByTestId('peers-add').click();
  await page.getByTestId('peers-address-1').fill(`localhost:${rocky.port}`);
  await page.getByTestId('peers-add').click();
  await page.getByTestId('peers-address-2').fill(`localhost:${nobody}`);

  await page.getByTestId('peers-test-connection').click();
  await expect(page.getByTestId('peers-probe-0')).toContainText('Answered');
  await expect(page.getByTestId('peers-probe-0')).toContainText('kyle on KYLE-PC');
  await expect(page.getByTestId('peers-probe-1')).toContainText('Signature rejected');
  await expect(page.getByTestId('peers-probe-2')).toContainText('Unreachable');
  await expect(page.getByTestId('peers-test-outcome')).toContainText(`localhost:${rocky.port} uses a different team secret.`);
  await expect(page.getByTestId('connections-save')).toBeDisabled();

  // Without the peer on another secret the test passes, with the unreachable one still listed.
  await page.getByTestId('peers-remove-1').click();
  await page.getByTestId('peers-test-connection').click();
  await expect(page.getByTestId('peers-test-outcome')).toContainText('1 answered · 1 unreachable');
  await page.getByTestId('connections-save').click();
  await expect(page.getByRole('dialog', { name: 'Connections' })).toHaveCount(0);
  await openPeersTab();
  await expect(page.getByTestId('connection-peers')).toContainText(`Port ${appPort} · 2 peers · secret ••••••••Tq7V`);

  await expect.poll(async () => (await data<PeerNetworkStatus>('peers:list')).listener).toEqual({ state: 'listening', port: appPort, message: null });
  await expect.poll(async () => (await data<PeerNetworkStatus>('peers:list')).peers.find((peer) => peer.address === `localhost:${kyle.port}`)?.state, { timeout: 15_000 }).toBe('online');
  await expect(page.getByTestId(`peer-status-localhost:${kyle.port}`)).toContainText('Online');
  expect(kyle.network.online()).toHaveLength(1);
  await page.getByTestId('connections-cancel').click();
});

test('saving a new port restarts the listener without restarting the app', async () => {
  const newPort = await freePort();
  await openPeersTab();
  await page.getByTestId('connection-peers-replace').click();
  await page.getByTestId('peers-port').fill(String(newPort));
  await page.getByTestId('peers-test-connection').click();
  await expect(page.getByTestId('peers-test-outcome')).toContainText('1 answered');
  await page.getByTestId('connections-save').click();
  await expect.poll(async () => (await data<PeerNetworkStatus>('peers:list')).listener.port).toBe(newPort);
  await expect.poll(async () => (await data<PeerNetworkStatus>('peers:list')).peers.find((peer) => peer.address === `localhost:${kyle.port}`)?.state, { timeout: 15_000 }).toBe('online');
});

test('the team secret is in no IPC reply and in no file but the encrypted secrets file', async () => {
  const rows = await data<ConnectionSummary[]>('connections:list');
  expect(rows.find((row) => row.kind === 'peers')).toMatchObject({ maskedToken: '••••••••Tq7V' });
  for (const reply of replies) expect(reply).not.toContain(SECRET);
  const walk = (folder: string): string[] =>
    readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.name !== 'secrets.json' && /\.(json|log|txt)$/.test(entry.name) ? [path] : [];
    });
  for (const file of walk(userDataDir)) expect(readFileSync(file, 'utf8'), file).not.toContain(SECRET);
});
