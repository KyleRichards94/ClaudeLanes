import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { E2E_TICKET_START, e2eTicketRecord, seedTicketRecords } from './support/ticket-records';

/**
 * AL-192: the Claude Design tab page in the real app. No canvas is linked here, so no view loads and
 * nothing is sent to claude.ai.
 */

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-design-tab-'));
  seedTicketRecords(userDataDir, [
    e2eTicketRecord(),
    e2eTicketRecord({ id: '71274', title: 'Queued ticket', stage: 'queued', stageHistory: [{ stage: 'queued', at: E2E_TICKET_START }] }),
    e2eTicketRecord({
      id: '71275',
      title: 'Merged ticket',
      stage: 'done',
      stageHistory: [
        { stage: 'queued', at: E2E_TICKET_START },
        { stage: 'done', at: E2E_TICKET_START + 1 },
      ],
    }),
  ]);
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));
  await expect(page.getByText('Agent board')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

async function openHash(hash: string) {
  await page.evaluate((next) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = next;
  }, hash);
}

test('shows the compact header, the tab bar, the browser bar and the side panel', async () => {
  await openHash('#/ticket/71273/design');

  await expect(page.getByRole('heading', { name: 'Cutover frmJobControl to Blazor', level: 1 })).toBeVisible();
  await expect(page.getByTestId('design-stage-pill')).toHaveText('Implementing');
  await expect(page.getByText('Opus · XHigh')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Claude Design' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('design-canvas-label')).toHaveText('No canvas linked');
  await expect(page.getByTestId('design-no-canvas')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Attached to this ticket' })).toBeVisible();

  // The side panel sits right of the canvas, as on artboard 4.
  const bar = await page.getByTestId('design-browser-bar').boundingBox();
  const side = await page.getByTestId('design-side-panel').boundingBox();
  expect(side!.x).toBeGreaterThan(bar!.x + bar!.width);
});

test('opens in every stage, Queued through Done (R11)', async () => {
  for (const [id, stage] of [
    ['71274', 'Queued'],
    ['71275', 'Done'],
  ] as const) {
    await openHash(`#/ticket/${id}/design`);
    await expect(page.getByTestId('design-stage-pill')).toHaveText(stage);
    await expect(page.getByTestId('design-browser-bar')).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Claude Design' })).toHaveAttribute('aria-selected', 'true');
  }
});

test('goes back to the drill-in from the tab bar', async () => {
  await openHash('#/ticket/71273/design');
  await page.getByRole('tab', { name: 'ADO' }).click();
  await expect(page.getByTestId('ticket-tab-ado')).toBeVisible();
});
