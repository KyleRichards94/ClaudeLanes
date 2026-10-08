import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { ADO_FIXTURE_PAT } from '@agent-lanes/ado-client/testing';
import type { ConnectionSummary, Result } from '@agent-lanes/contracts';
import { ADO_FIXTURE_ORG_ID } from '@agent-lanes/contracts/testing';
import { startFakeAdoServer, type FakeAdoServer } from './support/fake-ado-server';

/**
 * AL-048 in the real app: a token Azure DevOps refuses (401) turns the organisation red and raises an
 * error toast whose Reconnect opens Connections on that row; replacing the token reconnects without a
 * restart. Azure DevOps is the shared fake organisation on 127.0.0.1; both PATs are made up. Pausing
 * and resuming the agents themselves runs against the fake Agent SDK in the main-process tests.
 */

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

/** Made up; the fake organisation refuses it with 401. */
const REVOKED_PAT = 'fakepatAL048e2erevoked0only1111never2222real3333zzE8';

let ado: FakeAdoServer;
let userDataDir: string;
let app: ElectronApplication | undefined;
let page: Page;

async function invoke<T>(channel: string, payload?: unknown): Promise<Result<T>> {
  return (await page.evaluate(
    ([name, body]) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name, body),
    [channel, payload] as const,
  )) as Result<T>;
}

async function contoso(): Promise<ConnectionSummary | undefined> {
  const reply = await invoke<ConnectionSummary[]>('connections:list');
  if (!reply.ok) throw new Error(reply.message);
  return reply.data.find((row) => row.id === ADO_FIXTURE_ORG_ID);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ado = await startFakeAdoServer();
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-credential-failure-'));
  app = await electron.launch({ args: [join(__dirname, '..')], env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir } });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await ado?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('a 401 turns the organisation red and raises a toast whose Reconnect opens its row', async () => {
  expect(await invoke('connections:save', { kind: 'ado', orgUrl: ado.orgUrl, pat: ADO_FIXTURE_PAT, defaultProject: 'OnSite Companion' })).toMatchObject({ ok: true });
  expect(await invoke('ado:getWorkItem', { id: 71273 })).toMatchObject({ ok: true });

  // The token is revoked: the next call is refused with 401.
  expect(await invoke('connections:replace', { id: ADO_FIXTURE_ORG_ID, draft: { kind: 'ado', orgUrl: ado.orgUrl, pat: REVOKED_PAT } })).toMatchObject({ ok: true });
  expect(await invoke('ado:getWorkItem', { id: 71273 })).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });

  await expect.poll(async () => (await contoso())?.status).toBe('error');
  expect((await contoso())?.statusMessage).toContain('Azure DevOps refused this token (401)');

  const card = page.getByTestId(`toast-ado-unauthorized:${ADO_FIXTURE_ORG_ID}`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText('Azure DevOps refused the token for contoso');

  await card.getByRole('button', { name: 'Reconnect' }).click();
  await expect(page.getByRole('dialog', { name: 'Connections' })).toBeVisible();
  await expect(page.getByTestId('ado-pat')).toBeFocused();
  await page.keyboard.press('Escape');
});

test('replacing the token reconnects without restarting the app', async () => {
  expect(await invoke('connections:replace', { id: ADO_FIXTURE_ORG_ID, draft: { kind: 'ado', orgUrl: ado.orgUrl, pat: ADO_FIXTURE_PAT } })).toMatchObject({ ok: true });
  await expect.poll(async () => (await contoso())?.status).not.toBe('error');
  await expect(page.getByTestId(`toast-ado-unauthorized:${ADO_FIXTURE_ORG_ID}`)).toContainText('contoso reconnected', { timeout: 15_000 });
  expect(await invoke('ado:getWorkItem', { id: 71273 })).toMatchObject({ ok: true });
});
