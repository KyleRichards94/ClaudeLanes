import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/**
 * AL-066 in the real app: ADO queries poll every 60 s only while the board shows and never while the
 * window is minimised or hidden. The page's own visibility can't be relied on for that (it stays
 * `visible` under Playwright, and when Chromium keeps a renderer awake), so main tells the renderer
 * with `app:window`, which stops TanStack Query's polls. This checks main's side through the real
 * preload; the polling itself is unit-tested with fake timers in `shared/api/ado.test.tsx`.
 */

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

interface Scope {
  agentLanes: { on(channel: string, listener: (payload: { visible: boolean }) => void): () => void };
  windowEvents?: boolean[];
}

const windowEvents = () => page.evaluate(() => (globalThis as unknown as Scope).windowEvents ?? []);
const mainWindow = (action: 'minimize' | 'restore' | 'hide' | 'show') =>
  app.evaluate(({ BrowserWindow }, name) => BrowserWindow.getAllWindows()[0]?.[name](), action);

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-'));
  app = await electron.launch({ args: [join(__dirname, '..')], env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir } });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
  await page.evaluate(() => {
    const scope = globalThis as unknown as Scope;
    scope.windowEvents = [];
    scope.agentLanes.on('app:window', ({ visible }) => scope.windowEvents?.push(visible));
  });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('main says when the window is minimised and restored', async () => {
  await mainWindow('minimize');
  await expect.poll(windowEvents, { timeout: 10_000 }).toEqual([false]);
  await mainWindow('restore');
  await expect.poll(windowEvents, { timeout: 10_000 }).toEqual([false, true]);
});

test('main says when the window is hidden and shown', async () => {
  await mainWindow('hide');
  await expect.poll(windowEvents, { timeout: 10_000 }).toEqual([false, true, false]);
  await mainWindow('show');
  await expect.poll(windowEvents, { timeout: 10_000 }).toEqual([false, true, false, true]);
  await expect(page.getByText('Agent board')).toBeVisible();
});
