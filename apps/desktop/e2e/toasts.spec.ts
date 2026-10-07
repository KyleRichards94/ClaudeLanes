import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-'));
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

/** Sends a `toast` event to the main window's top frame, the way main's `emit` delivers it (AL-012). */
async function sendToast(payload: unknown) {
  await app.evaluate(({ BrowserWindow }, eventPayload) => {
    BrowserWindow.getAllWindows()[0]?.webContents.mainFrame.send('toast', eventPayload);
  }, payload);
}

/**
 * Raises a toast from main and waits until it shows. Resends while it hasn't, in case the event
 * landed before the renderer was listening; a toast with the same id replaces itself, so a resend
 * never stacks a copy.
 */
async function toastFromMain(payload: { id: string; title: string } & Record<string, unknown>) {
  const card = page.getByTestId(`toast-${payload.id}`);
  await expect(async () => {
    if ((await card.count()) === 0) await sendToast(payload);
    await expect(card).toContainText(payload.title, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

test('shows an error toast raised by main until it is acted on', async () => {
  await toastFromMain({
    at: 1,
    id: 'session-lost:71288',
    tone: 'error',
    title: 'MCP bridge lost the session',
    body: 'cc-71288 stopped responding. The worktree is intact.',
    actions: [{ label: 'Open board', intent: { type: 'navigate', route: { name: 'board' } } }],
  });

  const notifications = page.getByRole('region', { name: 'Notifications' });
  const alert = notifications.getByRole('alert');
  await expect(alert).toContainText('MCP bridge lost the session');
  await expect(alert.getByRole('button', { name: 'Open board' })).toBeVisible();

  await page.waitForTimeout(6_000);
  await expect(alert).toBeVisible();

  await alert.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notifications.getByRole('alert')).toHaveCount(0);
});

test('closes an info toast raised by main after 5 s', async () => {
  await toastFromMain({ at: 2, id: 'diagnostics-copied', tone: 'info', title: 'Diagnostics copied' });

  const status = page.getByRole('region', { name: 'Notifications' }).getByRole('status');
  await expect(status).toContainText('Diagnostics copied');
  await expect(status).toHaveCount(0, { timeout: 8_000 });
});
