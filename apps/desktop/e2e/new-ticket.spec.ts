import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/**
 * New agent ticket (AL-160) in the real app, driven with the keyboard only: Tab to "+ New agent
 * ticket", open it, choose "No ticket", describe the job, Tab to "Launch agent" and press Enter.
 * Launch itself is AL-165; until then the app acknowledges the request with a toast.
 */

let userDataDir: string;
let app: ElectronApplication | undefined;

test.beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-new-ticket-'));
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(userDataDir, { recursive: true, force: true });
});

/** What the focused element is called: its aria-label, else its placeholder, else its text. */
function focusedName(page: Page): Promise<string> {
  // A string, because the e2e project has no DOM types.
  return page.evaluate<string>(`(() => {
    const element = document.activeElement;
    return element?.getAttribute('aria-label') ?? element?.getAttribute('placeholder') ?? element?.textContent?.trim() ?? '';
  })()`);
}

async function tabTo(page: Page, name: string | RegExp): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    const current = await focusedName(page);
    if (typeof name === 'string' ? current === name : name.test(current)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached ${String(name)} (focus is on "${await focusedName(page)}")`);
}

test('goes from the board to a launched request with the keyboard only', async () => {
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));
  await expect(page.getByText('Agent board')).toBeVisible();

  await tabTo(page, 'New agent ticket');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'New agent ticket' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Linked to|No work item picked yet/)).toBeVisible();

  await tabTo(page, 'Sprint');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('radio', { name: 'No ticket' })).toHaveAttribute('aria-checked', 'true');

  await tabTo(page, /^Describe the job/);
  await page.keyboard.type('Fix the supplier portal login redirect loop');
  await page.screenshot({ path: test.info().outputPath('new-ticket.png') });

  await tabTo(page, 'Launch agent');
  await page.keyboard.press('Enter');

  await expect(dialog).toBeHidden();
  await expect(page.getByText('Agent ticket is ready')).toBeVisible();
});
