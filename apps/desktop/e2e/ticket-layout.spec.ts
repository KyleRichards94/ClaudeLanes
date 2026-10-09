import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { e2eTicketRecord, seedTicketRecords } from './support/ticket-records';

/**
 * AL-250: the output-first drill-in in the real app. At 1440 × 900 the transcript starts near the top
 * and the composer is on screen without scrolling; at 1100 × 800 the rail stacks under the panel and
 * the transcript still gets most of the window. Every control from the old panels is still on the page.
 */

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-ticket-layout-'));
  seedTicketRecords(userDataDir, [e2eTicketRecord({ sessionId: null })]);
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
  await page.evaluate(() => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = '#/ticket/71273';
  });
  await expect(page.getByTestId('ticket-title')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

async function setContentSize(width: number, height: number) {
  await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height), { width, height });
}

test('at 1440 × 900 the transcript starts within 260 px of the top and the composer is on screen', async () => {
  await setContentSize(1440, 900);
  await expect(page.getByTestId('ticket-body-wide')).toBeVisible();
  const output = await page.getByTestId('ticket-tab-output').boundingBox();
  const composer = await page.getByTestId('composer').boundingBox();
  const viewport = page.viewportSize() ?? (await page.evaluate(() => {
    const view = globalThis as unknown as { innerWidth: number; innerHeight: number };
    return { width: view.innerWidth, height: view.innerHeight };
  }));
  expect(output).not.toBeNull();
  expect(output!.y).toBeLessThanOrEqual(260);
  expect(composer).not.toBeNull();
  expect(composer!.y + composer!.height).toBeLessThanOrEqual(viewport.height + 1);
  // The transcript's card runs down to the composer, not a fixed 560 px.
  expect(output!.height).toBeGreaterThan(300);
});

test('at 1100 × 800 the rail stacks under the panel and the transcript keeps at least 360 px', async () => {
  await setContentSize(1100, 800);
  await expect(page.getByTestId('ticket-body-stacked')).toBeVisible();
  const panel = await page.getByTestId('ticket-tab-panel').boundingBox();
  const output = await page.getByTestId('ticket-tab-output').boundingBox();
  const rail = await page.getByTestId('ticket-side-column').boundingBox();
  expect(output!.height).toBeGreaterThanOrEqual(360);
  expect(rail!.y).toBeGreaterThanOrEqual(panel!.y + panel!.height - 1);
  await setContentSize(1440, 900);
  await expect(page.getByTestId('ticket-body-wide')).toBeVisible();
});

test('every control from the old panels is still reachable', async () => {
  for (const name of ['Build', 'Run', 'Stop']) await expect(page.getByTestId('build-run').getByRole('button', { name })).toBeVisible();
  await expect(page.getByTestId('merge-sub-branches')).toBeVisible();
  await expect(page.getByTestId('merge-to-main')).toBeVisible();
  await expect(page.getByTestId('agent-model')).toBeVisible();
  await expect(page.getByTestId('agent-effort')).toBeVisible();
  await expect(page.getByTestId('stage-gate-planning')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sub-branches', level: 2 })).toBeVisible();
});
