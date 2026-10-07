import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { TicketRecord } from '@agent-lanes/contracts';
import { fakeClaudeEnv, writeFakeClaudeState } from './support/fake-claude-code';
import { startFakeClaudeSite } from './support/fake-claude-site';
import { e2eTicketRecord, seedTicketRecords } from './support/ticket-records';

/**
 * AL-193: linking a Claude Design canvas to a ticket, and reopening it on the same artboard after a
 * restart. The canvas is served by a local stand-in for claude.ai; nothing reaches claude.ai.
 */

const CANVAS = 'https://claude.ai/design/p/canvas-a';
const ARTBOARD = `${CANVAS}#artboard=jobfilter`;

let site: Awaited<ReturnType<typeof startFakeClaudeSite>>;
let userDataDir: string;
let app: ElectronApplication | undefined;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  site = await startFakeClaudeSite();
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-design-canvas-'));
  seedTicketRecords(userDataDir, [e2eTicketRecord()]);
  // The artboard list's design session starts this fake, never the real claude binary (AL-195).
  writeFakeClaudeState(join(userDataDir, 'fake-claude.json'), { login: null });
});

test.afterAll(async () => {
  await app?.close();
  await site?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

async function launch(): Promise<Page> {
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir, AGENT_LANES_DESIGN_TEST_ORIGIN: site.origin, ...fakeClaudeEnv(join(userDataDir, 'fake-claude.json')) },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));
  // Links handed to the OS browser are recorded instead of opening one.
  await app.evaluate(({ shell }) => {
    const probe = globalThis as unknown as { openedExternally: string[] };
    probe.openedExternally = [];
    shell.openExternal = async (url: string) => {
      probe.openedExternally.push(url);
    };
  });
  await expect(page.getByText('Agent board')).toBeVisible();
  await page.evaluate(() => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = '#/ticket/71273/design';
  });
  return page;
}

/** The URL of the design view main shows over the window, if any. */
function viewUrl(): Promise<string | null> {
  return app!.evaluate(({ BrowserWindow }) => {
    const view = BrowserWindow.getAllWindows()[0]?.contentView.children.find((child) => 'webContents' in child) as
      | Electron.WebContentsView
      | undefined;
    return view ? view.webContents.getURL() : null;
  });
}

function savedRecord(): TicketRecord {
  const folder = join(userDataDir, 'tickets', 'onsite-companion-0123456789ab');
  const file = readdirSync(folder).find((name) => name === '71273.json') ?? '';
  return JSON.parse(readFileSync(join(folder, file), 'utf8')) as TicketRecord;
}

test('links a pasted canvas link and shows the canvas', async () => {
  const page = await launch();

  await page.getByTestId('link-canvas-url').fill('https://claude.ai/chat/not-a-canvas');
  await page.getByRole('button', { name: 'Link canvas' }).click();
  await expect(page.getByText(/isn't a Claude Design canvas link/)).toBeVisible();

  await page.getByTestId('link-canvas-url').fill(`${CANVAS}?utm_source=share`);
  await page.getByRole('button', { name: 'Link canvas' }).click();

  await expect(page.getByTestId('design-canvas-slot')).toBeVisible();
  await expect(page.getByTestId('design-view-status')).toHaveText('Webview · signed in');
  await expect.poll(viewUrl).toBe(`${site.origin}/design/p/canvas-a`);
});

test('reopens the linked canvas on the same artboard after an app restart', async () => {
  // The user moves to another artboard inside the canvas.
  await app!.evaluate(async ({ webContents }, origin) => {
    const view = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith(origin));
    await view?.executeJavaScript("location.hash = 'artboard=jobfilter'; true");
  }, site.origin);
  await expect.poll(viewUrl).toBe(`${site.origin}/design/p/canvas-a#artboard=jobfilter`);

  await app!.close();
  app = undefined;
  expect(savedRecord().design).toMatchObject({ canvas: { kind: 'design-project', id: 'canvas-a', url: CANVAS }, lastViewUrl: ARTBOARD });

  const page = await launch();
  await expect(page.getByTestId('design-canvas-slot')).toBeVisible();
  await expect.poll(viewUrl).toBe(`${site.origin}/design/p/canvas-a#artboard=jobfilter`);

  // "Open in Claude ↗" opens the same artboard on claude.ai, in the OS browser.
  await page.getByRole('button', { name: 'Open in Claude' }).click();
  await expect
    .poll(() => app!.evaluate(() => (globalThis as unknown as { openedExternally: string[] }).openedExternally))
    .toEqual([ARTBOARD]);
});

test('unlinks the canvas', async () => {
  const page = (await app!.firstWindow()) as Page;
  await page.getByRole('button', { name: 'Change canvas' }).click();
  await page.getByRole('button', { name: 'Unlink canvas' }).click();
  await expect(page.getByRole('heading', { name: 'Link a Claude Design canvas' })).toBeVisible();
  await expect.poll(viewUrl).toBeNull();
});
