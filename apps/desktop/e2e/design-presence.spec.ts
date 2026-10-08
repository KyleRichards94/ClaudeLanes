import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { TicketDesignSpec } from '@agent-lanes/contracts';
import { E2E_TICKET_START, e2eTicketRecord, seedTicketRecords } from './support/ticket-records';

/**
 * AL-200: which tickets have a design the agent has not acknowledged, seen from the board. Ticket
 * 71273 has Design v3 shipped and not yet used; 71288 has Design v1, used. `design:spec` is sent the
 * way main's `emit` sends it, so it passes the preload's contract check and the event hub.
 */

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

test.describe.configure({ mode: 'serial' });

function spec(version: number, usedAt: number | null): TicketDesignSpec {
  return { version, shippedAt: E2E_TICKET_START + version * 60_000, approvedBy: 'Kyle', artboardCount: 2, usedAt, fetchedAt: null, deliveredAt: null };
}

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-design-presence-'));
  seedTicketRecords(userDataDir, [
    e2eTicketRecord({ design: { canvas: null, lastViewUrl: null, specs: [spec(1, E2E_TICKET_START + 90_000), spec(2, null), spec(3, null)] } }),
    e2eTicketRecord({
      id: '71288',
      title: 'Job grid filters',
      ado: { orgUrl: 'https://dev.azure.com/contoso', project: 'OnSite Companion', workItemId: 71288 },
      branch: '71288-job-grid-filters',
      worktreePath: 'C:\\src\\.agent-lanes\\71288',
      sessionId: null,
      design: { canvas: null, lastViewUrl: null, specs: [spec(1, E2E_TICKET_START + 90_000)] },
    }),
    e2eTicketRecord({ id: '71301', title: 'No design here', ado: { orgUrl: 'https://dev.azure.com/contoso', project: 'OnSite Companion', workItemId: 71301 }, branch: '71301-no-design', worktreePath: 'C:\\src\\.agent-lanes\\71301', sessionId: null }),
  ]);
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('the board shows which tickets have a design the agent has not used yet', async () => {
  await expect(page.getByTestId('card-71273-design')).toHaveText('Design v3 not yet used');
  await expect(page.getByTestId('card-71288-design')).toHaveText('Design v1');
  await expect(page.getByTestId('card-71301')).toBeVisible();
  await expect(page.getByTestId('card-71301-design')).toHaveCount(0);
});

test('the card and the live dock follow the agent acknowledging the spec', async () => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.mainFrame.send('design:spec', { ticketId: '71273', at: Date.now(), version: 3, change: 'used' });
  });
  await expect(page.getByTestId('card-71273-design')).toHaveText('Design v3');
  await expect(page.getByTestId('live-dock')).toContainText('Design v3 used by the agent');

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.mainFrame.send('design:spec', { ticketId: '71288', at: Date.now(), version: 2, change: 'shipped' });
  });
  await expect(page.getByTestId('card-71288-design')).toHaveText('Design v2 not yet used');
  await expect(page.getByTestId('live-dock')).toContainText('Design v2 shipped to the agent');
});
