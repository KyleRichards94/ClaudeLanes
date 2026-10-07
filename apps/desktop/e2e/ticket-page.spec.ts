import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { e2eTicketRecord, seedTicketRecords } from './support/ticket-records';

/**
 * AL-170: the ticket drill-in frame in the real app, from a ticket record on disk. Azure DevOps is
 * not connected, so nothing leaves the machine.
 */

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-ticket-page-'));
  seedTicketRecords(userDataDir, [e2eTicketRecord()]);

  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

async function setContentWidth(width: number) {
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(size, 960);
  }, width);
}

test('lays out the drill-in at 1440 wide with the sub-agent column on the right', async () => {
  await setContentWidth(1440);
  await page.evaluate(() => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = '#/ticket/71273';
  });

  await expect(page.getByRole('heading', { name: 'Cutover frmJobControl to Blazor', level: 1 })).toBeVisible();
  await expect(page.getByTestId('ticket-breadcrumb')).toHaveText('onsite-companion / #71273');
  await expect(page.getByTestId('session-pill')).toContainText('Session cc-71273');
  await expect(page.getByLabel('Planning, done, 12m')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Output' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('ticket-body-wide')).toBeVisible();

  const output = await page.getByTestId('ticket-tab-panel').boundingBox();
  const side = await page.getByTestId('ticket-side-column').boundingBox();
  expect(output).not.toBeNull();
  expect(side).not.toBeNull();
  // Side by side: the column starts right of the output card, level with its top.
  expect(side!.x).toBeGreaterThan(output!.x + output!.width);
  expect(Math.abs(side!.y - output!.y)).toBeLessThan(2);
  // The 400 px column ends at the page's 24 px margin, as on artboard 3.
  expect(Math.round(side!.width)).toBe(400);
});

test('stacks the sub-agent column under the output below 1200 wide', async () => {
  await setContentWidth(1100);
  await expect(page.getByTestId('ticket-body-stacked')).toBeVisible();

  const output = await page.getByTestId('ticket-tab-panel').boundingBox();
  const side = await page.getByTestId('ticket-side-column').boundingBox();
  expect(side!.y).toBeGreaterThan(output!.y + output!.height);
  await setContentWidth(1440);
  await expect(page.getByTestId('ticket-body-wide')).toBeVisible();
});

test('switches tabs and opens Claude Design on its own page', async () => {
  await page.getByRole('tab', { name: 'Diff' }).click();
  await expect(page.getByTestId('ticket-tab-diff')).toBeVisible();

  await page.getByRole('tab', { name: 'Claude Design' }).click();
  await expect(page.getByTestId('design-tab-page')).toBeVisible();

  await page.keyboard.press('Alt+ArrowLeft');
  // Back on the drill-in, on the tab it was left on.
  await expect(page.getByTestId('ticket-tab-diff')).toBeVisible();
});
