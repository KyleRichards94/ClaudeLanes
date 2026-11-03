import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { PeerNetworkStatus, Result } from '@agent-lanes/contracts';
import { ADO_FIXTURE_PROJECT, ADO_FIXTURE_PROJECT_ID } from '@agent-lanes/contracts/testing';
import { deriveTeam } from '../src/main/peers/signer';
import { OTHER_TEAM, beaconConfig, createTestPeer, freePort, type TestPeer } from '../src/main/peers/testing';
import { startFakeAdoServer, type FakeAdoServer } from './support/fake-ado-server';

/**
 * AL-298 against the real app: Connections › Peers is a status page. The app has a team as soon as
 * its Azure DevOps connection has a default project, and finds two fake peers started here by their
 * beacons on loopback (beacon port 47820, from playwright.config.ts): one in its project, which
 * connects, and one in another, shown as other team. Advanced changes the port without a restart.
 * Not run for AL-298 on Mitch's call (2026-10-30).
 */

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

const BEACON_PORT = 47820;

let userDataDir: string;
let ado: FakeAdoServer;
let app: ElectronApplication | undefined;
let page: Page;
let kyle: TestPeer;
let sam: TestPeer;

async function openPeersTab(): Promise<void> {
  await page.getByTestId('open-connections').click();
  await page.getByRole('tab', { name: /Peers/ }).click();
}

async function invoke<T>(channel: string, payload?: unknown): Promise<T> {
  const reply = (await page.evaluate(([name, body]) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name as string, body), [channel, payload])) as Result<T>;
  if (!reply.ok) throw new Error(`${channel} failed: ${reply.message}`);
  return reply.data;
}

const network = () => invoke<PeerNetworkStatus>('peers:list');

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-peers-'));
  ado = await startFakeAdoServer();
  const team = deriveTeam(ado.orgUrl, ADO_FIXTURE_PROJECT_ID);
  kyle = createTestPeer('kyle', await freePort());
  sam = createTestPeer('sam', await freePort());
  await kyle.network.configure(beaconConfig(kyle.port, BEACON_PORT, [team]));
  await sam.network.configure(beaconConfig(sam.port, BEACON_PORT, [OTHER_TEAM]));
  app = await electron.launch({ args: [join(__dirname, '..')], env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir } });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
  await invoke('connections:save', { kind: 'ado', orgUrl: ado.orgUrl, pat: ado.pat, defaultProject: ADO_FIXTURE_PROJECT });
});

test.afterAll(async () => {
  await app?.close();
  await kyle?.network.dispose();
  await sam?.network.dispose();
  await ado?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('with nothing typed, the tab shows this computer, a found peer connected and one from another team', async () => {
  await expect.poll(async () => (await network()).teams, { timeout: 15_000 }).toBe(1);
  await expect.poll(async () => (await network()).peers.find((peer) => peer.instance === kyle.instance)?.state, { timeout: 20_000 }).toBe('online');
  await expect.poll(async () => (await network()).peers.find((peer) => peer.instance === sam.instance)?.state, { timeout: 20_000 }).toBe('other-team');
  expect(kyle.network.online()).toHaveLength(1);
  expect(sam.network.online()).toEqual([]);

  await openPeersTab();
  await expect(page.getByTestId('peers-listener')).toContainText('Listening on port');
  await expect(page.getByTestId('peers-beacon')).toContainText(`Beacon on UDP port ${BEACON_PORT}`);
  await expect(page.getByTestId('peers-teams')).toHaveText('Team: 1 Azure DevOps project');
  const status = await network();
  const kyleRow = status.peers.find((peer) => peer.instance === kyle.instance)!;
  const samRow = status.peers.find((peer) => peer.instance === sam.instance)!;
  await expect(page.getByTestId(`peer-status-${kyleRow.address}`)).toContainText('Connected');
  await expect(page.getByTestId(`peer-status-${kyleRow.address}`)).toContainText('kyle on KYLE-PC');
  await expect(page.getByTestId(`peer-status-${samRow.address}`)).toContainText('Other team');
  await expect(page.getByTestId('peers-secret')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: /Peers, 1 connected/ })).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('peers-tab-1440x960.png') });
});

test('Find peers finds a peer that started after the app', async () => {
  const late = createTestPeer('rocky', await freePort());
  try {
    await late.network.configure(beaconConfig(late.port, BEACON_PORT, [deriveTeam(ado.orgUrl, ADO_FIXTURE_PROJECT_ID)]));
    await page.getByTestId('peers-find').click();
    await expect.poll(async () => (await network()).peers.find((peer) => peer.instance === late.instance)?.state, { timeout: 20_000 }).toBe('online');
  } finally {
    await late.network.dispose();
  }
  await page.getByTestId('connections-cancel').click();
});

test('a new port under Advanced restarts the listener without restarting the app', async () => {
  const newPort = await freePort();
  await openPeersTab();
  await page.getByTestId('peers-port').fill(String(newPort));
  await page.getByTestId('connections-save').click();
  await expect.poll(async () => (await network()).listener.port).toBe(newPort);
  await expect.poll(async () => (await network()).peers.find((peer) => peer.instance === kyle.instance)?.state, { timeout: 20_000 }).toBe('online');
});

test('no key and no team secret is written anywhere in the profile', async () => {
  const key = deriveTeam(ado.orgUrl, ADO_FIXTURE_PROJECT_ID).key.toString('hex');
  const walk = (folder: string): string[] =>
    readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) return walk(path);
      return /\.(json|log|txt)$/.test(entry.name) ? [path] : [];
    });
  for (const file of walk(userDataDir)) {
    const text = readFileSync(file, 'utf8');
    expect(text, file).not.toContain(key);
    expect(text, file).not.toContain('peers:team-secret');
  }
});
