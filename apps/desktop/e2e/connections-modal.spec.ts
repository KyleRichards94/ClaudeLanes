import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { ADO_FIXTURE_PAT } from '@agent-lanes/ado-client/testing';
import type { ConnectionSummary, Result } from '@agent-lanes/contracts';
import { ADO_FIXTURE_IDENTITY } from '@agent-lanes/contracts/testing';
import { seriousAxeViolations } from './support/accessibility';
import { startFakeAdoServer, type FakeAdoServer } from './support/fake-ado-server';

/**
 * AL-046 in the real app: the Connections modal opened from the board header adds an Azure DevOps
 * organisation (Test connection, then Save), shows the saved row, and a Reconnect toast from main
 * lands on that row with the PAT field focused. Azure DevOps is the shared fake organisation on
 * 127.0.0.1 and the PAT is its fixture, valid nowhere.
 */

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

let ado: FakeAdoServer;
let userDataDir: string;
let app: ElectronApplication | undefined;
let page: Page;

async function connections(): Promise<ConnectionSummary[]> {
  const reply = (await page.evaluate(() => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke('connections:list'))) as Result<ConnectionSummary[]>;
  if (!reply.ok) throw new Error(reply.message);
  return reply.data;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ado = await startFakeAdoServer();
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-connections-modal-'));
  app = await electron.launch({ args: [join(__dirname, '..')], env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir } });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await ado?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('adds an organisation: Save waits for Test connection, and the saved row shows who it signs in as', async () => {
  await page.getByTestId('open-connections').click();
  const dialog = page.getByRole('dialog', { name: 'Connections' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Tokens are encrypted on this computer and never shown again after you save them.')).toBeVisible();

  const save = page.getByTestId('connections-save');
  await expect(save).toBeDisabled();
  await page.getByTestId('ado-org-url').fill(ado.orgUrl);
  await page.getByTestId('ado-pat').fill(ADO_FIXTURE_PAT);
  await expect(save).toBeDisabled();

  await page.getByTestId('ado-test-connection').click();
  await expect(page.getByTestId('ado-test-outcome')).toContainText(`signed in as ${ADO_FIXTURE_IDENTITY}`);
  await expect(page.getByTestId('ado-scope-work-items')).toContainText('Work Items · ok');
  await expect(save).toBeEnabled();
  await page.screenshot({ path: join(__dirname, '..', 'test-results', 'connections-modal.png') });

  await save.click();
  await expect(dialog).toHaveCount(0);

  const [row] = await connections();
  expect(row).toMatchObject({ kind: 'ado', status: 'ok', identity: ADO_FIXTURE_IDENTITY, maskedToken: `••••••••${ADO_FIXTURE_PAT.slice(-4)}` });

  await page.getByTestId('open-connections').click();
  await expect(page.getByTestId(`connection-${row?.id}-details`)).toHaveText(
    `${ado.orgUrl.replace(/^https?:\/\//, '')} · signed in as ${ADO_FIXTURE_IDENTITY} · token ••••••••${ADO_FIXTURE_PAT.slice(-4)}`,
  );
  // The token field gave its value up on Save.
  await expect(page.getByTestId('ado-pat')).toHaveValue('');
  await page.screenshot({ path: join(__dirname, '..', 'test-results', 'connections-modal-saved.png') });
});

test('the open modal has no serious axe violations (AL-033)', async () => {
  await expect(page.getByRole('dialog', { name: 'Connections' })).toBeVisible();
  expect(await seriousAxeViolations(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Connections' })).toHaveCount(0);
});

test("a Reconnect toast lands on that organisation's row with the PAT field focused", async () => {
  const [row] = await connections();
  const toast = {
    at: Date.now(),
    id: `ado-unauthorized:${row?.id}`,
    tone: 'error',
    title: 'Azure DevOps refused the token',
    body: 'Reconnect to keep agents on this organisation running.',
    actions: [{ label: 'Reconnect', intent: { type: 'openConnections', connectionId: row?.id } }],
  };
  const card = page.getByTestId(`toast-${toast.id}`);
  await expect(async () => {
    if ((await card.count()) === 0) {
      await app?.evaluate(({ BrowserWindow }, payload) => {
        BrowserWindow.getAllWindows()[0]?.webContents.mainFrame.send('toast', payload);
      }, toast);
    }
    await expect(card).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });

  await card.getByRole('button', { name: 'Reconnect' }).click();
  await expect(page.getByRole('dialog', { name: 'Connections' })).toBeVisible();
  await expect(page.getByRole('group', { name: `Replace the token for ${row?.name}` })).toBeVisible();
  await expect(page.getByTestId('ado-pat')).toBeFocused();
});
