import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { startFakeClaudeSite } from './support/fake-claude-site';
import { e2eTicketRecord, seedTicketRecords } from './support/ticket-records';

/**
 * AL-194: the embed mode switch and the MCP-link fallback, against a local stand-in for claude.ai
 * whose canvas redirects to its sign-in page. Nothing reaches claude.ai.
 */

let site: Awaited<ReturnType<typeof startFakeClaudeSite>>;
let userDataDir: string;
let app: ElectronApplication | undefined;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  site = await startFakeClaudeSite();
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-embed-mode-'));
  const canvas = { kind: 'design-project' as const, id: 'signed-out', url: 'https://claude.ai/design/p/signed-out' };
  seedTicketRecords(userDataDir, [e2eTicketRecord({ design: { canvas, lastViewUrl: null, specs: [] } })]);
});

test.afterAll(async () => {
  await app?.close();
  await site?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

async function launch(): Promise<Page> {
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir, AGENT_LANES_DESIGN_TEST_ORIGIN: site.origin },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));
  await expect(page.getByText('Agent board')).toBeVisible();
  await page.evaluate(() => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = '#/ticket/71273/design';
  });
  return page;
}

/** Whether main shows a design view over the window. */
function viewVisible(): Promise<boolean> {
  return app!.evaluate(({ BrowserWindow }) => {
    const views = BrowserWindow.getAllWindows()[0]?.contentView.children ?? [];
    return views.some((child) => 'webContents' in child && child.getVisible());
  });
}

test('offers MCP link mode when the webview lands on the sign-in page, and switches to it', async () => {
  const page = await launch();

  await expect(page.getByTestId('design-view-status')).toHaveText('Webview · sign-in needed');
  await expect(page.getByTestId('embed-mode-fallback')).toBeVisible();
  expect(await viewVisible()).toBe(true);

  await page.getByRole('button', { name: 'Use MCP link' }).click();

  await expect(page.getByRole('radio', { name: 'MCP link, Open in Claude, sync via MCP' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('design-mcp-link')).toBeVisible();
  await expect(page.getByTestId('design-view-status')).toHaveText('MCP link · opens in Claude');
  await expect.poll(viewVisible).toBe(false);
});

test('keeps the mode chosen for the ticket after a restart', async () => {
  await app!.close();
  app = undefined;

  const page = await launch();
  await expect(page.getByTestId('design-mcp-link')).toBeVisible();
  expect(await viewVisible()).toBe(false);

  await page.getByRole('radio', { name: 'Webview, Electron WebContentsView' }).click();
  await expect(page.getByTestId('design-canvas-slot')).toBeVisible();
  await expect.poll(viewVisible).toBe(true);
});
