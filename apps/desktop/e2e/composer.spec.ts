import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { e2eTicketRecord, seedTicketRecords } from './support/ticket-records';

/**
 * AL-176: the composer under the Output stream in the real app. No session runs (that needs Launch,
 * AL-165), so this checks the footer is wired to `agent:getStatus` and `agent:send` through the
 * preload; holding messages while paused and delivering them on Resume is covered by the session
 * manager's tests (session-messages.test.ts) and the composer's unit tests.
 */

let app: ElectronApplication;
let page: Page;
let userDataDir: string;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-composer-'));
  seedTicketRecords(userDataDir, [e2eTicketRecord({ skills: ['code-review', 'commit'], sessionId: null })]);
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));
  await page.evaluate(() => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = '#/ticket/71273';
  });
  await expect(page.getByTestId('composer')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('shows the skill chips, Apply model now, the message box, Pause and Send under the output', async () => {
  await expect(page.getByRole('button', { name: 'Run /code-review' })).toHaveText('/code-review');
  await expect(page.getByRole('button', { name: 'Run /commit' })).toBeVisible();
  await expect(page.getByPlaceholder('Message the agent — Enter sends, Shift+Enter for a new line')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByRole('button', { name: 'Send' })).toHaveAttribute('aria-disabled', 'true');

  // The composer sits under the stream, inside the Output card.
  const stream = await page.getByTestId('ticket-tab-output').boundingBox();
  const composer = await page.getByTestId('composer').boundingBox();
  expect(composer!.y).toBeGreaterThanOrEqual(stream!.y + stream!.height - 1);
  expect(Math.abs(composer!.x - stream!.x)).toBeLessThan(2);
});

test('says no session is running and shows why Enter could not send (AL-259)', async () => {
  await expect(page.getByTestId('composer-note')).toHaveText('No agent session is running for this ticket.');
  const box = page.getByPlaceholder('Message the agent — Enter sends, Shift+Enter for a new line');
  await box.fill('Use the existing JobFilterState');
  // Shift+Enter adds a line; Enter sends (AL-259).
  await box.press('Shift+Enter');
  await expect(page.getByTestId('composer-error')).toHaveCount(0);
  await box.press('Enter');
  await expect(page.getByTestId('composer-error')).toHaveText('No agent session is running for ticket 71273.');
  // The message stays in the box so it can be sent once the agent runs.
  await expect(box).toHaveValue('Use the existing JobFilterState\n');
});

test('offers the ticket skills after / and files after @, and takes a pasted image (AL-259)', async () => {
  const box = page.getByPlaceholder('Message the agent — Enter sends, Shift+Enter for a new line');
  await box.fill('');
  await box.pressSequentially('/co');
  const menu = page.getByRole('menu', { name: 'Completions' });
  await expect(menu).toContainText('/code-review');
  await expect(menu).toContainText('/commit');
  await box.press('ArrowDown');
  await box.press('Enter');
  await expect(box).toHaveValue('/commit ');

  await box.fill('');
  await box.pressSequentially('@grid');
  // No real worktree here: the picker says so instead of hanging.
  await expect(menu).toContainText(/No file matches|Looking for files/);
  await box.press('Escape');
  await expect(menu).toHaveCount(0);

  await box.fill('');
  await page.getByTestId('composer').evaluate((node) => {
    // The e2e tsconfig has no DOM lib: the page's own constructors are reached through globalThis.
    const win = globalThis as unknown as {
      DataTransfer: new () => { items: { add(file: unknown): void } };
      ClipboardEvent: new (type: string, init: { clipboardData: unknown; bubbles: boolean }) => Event;
    };
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const file = new File([bytes], 'pasted.png', { type: 'image/png' });
    const transfer = new win.DataTransfer();
    transfer.items.add(file);
    node.dispatchEvent(new win.ClipboardEvent('paste', { clipboardData: transfer, bubbles: true }));
  });
  await expect(page.getByTestId('composer-attachments')).toContainText('pasted.png');
  await page.getByRole('button', { name: 'Remove pasted.png' }).click();
  await expect(page.getByTestId('composer-attachments')).toHaveCount(0);
});
