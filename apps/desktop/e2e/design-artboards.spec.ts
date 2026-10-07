import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FAKE_LOGIN, fakeClaudeEnv, writeFakeClaudeState } from './support/fake-claude-code';
import { startFakeClaudeSite } from './support/fake-claude-site';
import { e2eTicketRecord, seedTicketRecords } from './support/ticket-records';

/**
 * AL-195: the "Hand off to agent" artboard list. The design session runs the fake `claude` binary,
 * which answers with the artboards in its state file, and the canvas is a local stand-in for
 * claude.ai; nothing leaves the machine.
 */

let site: Awaited<ReturnType<typeof startFakeClaudeSite>>;
let userDataDir: string;
let stateFile: string;
let app: ElectronApplication;
let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  site = await startFakeClaudeSite();
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-artboards-'));
  stateFile = join(userDataDir, 'fake-claude.json');
  writeFakeClaudeState(stateFile, {
    login: FAKE_LOGIN,
    design: {
      artboards: [
        { id: 'job-control.html', name: 'JobControl · desktop', width: 1440, height: 900 },
        { id: 'job-filter.html', name: 'JobFilter · side panel', width: 420, height: 900 },
      ],
    },
  });
  const canvas = { kind: 'design-project' as const, id: 'canvas-a', url: 'https://claude.ai/design/p/canvas-a' };
  seedTicketRecords(userDataDir, [e2eTicketRecord({ design: { canvas, lastViewUrl: null, specs: [] } })]);

  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir, AGENT_LANES_DESIGN_TEST_ORIGIN: site.origin, ...fakeClaudeEnv(stateFile) },
  });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));
  await expect(page.getByText('Agent board')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await site?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test("lists the canvas's artboards with sizes and checks them for the hand-off", async () => {
  await page.evaluate(() => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = '#/ticket/71273/design';
  });

  const control = page.getByRole('checkbox', { name: 'JobControl · desktop, 1440×900' });
  await expect(control).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'JobFilter · side panel, 420×900' })).toBeVisible();

  await control.click();
  await expect(control).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('button', { name: 'Send 1 artboard to agent as spec' })).toBeVisible();
});

test('shows artboards added or renamed on the canvas after Refresh', async () => {
  writeFakeClaudeState(stateFile, {
    login: FAKE_LOGIN,
    design: {
      artboards: [
        { id: 'job-control.html', name: 'JobControl · desktop wide', width: 1600, height: 900 },
        { id: 'job-filter.html', name: 'JobFilter · side panel', width: 420, height: 900 },
        { id: 'empty.html', name: 'Empty state', width: 600, height: 320 },
      ],
    },
  });
  await page.getByRole('button', { name: 'Refresh artboards' }).click();

  await expect(page.getByRole('checkbox', { name: 'Empty state, 600×320' })).toBeVisible();
  const renamed = page.getByRole('checkbox', { name: 'JobControl · desktop wide, 1600×900' });
  await expect(renamed).toBeVisible();
  // Same artboard file, so it stays picked.
  await expect(renamed).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('artboards-status')).toHaveText('3 artboards');
});

test('says when the Claude login has no Claude Design access', async () => {
  writeFakeClaudeState(stateFile, { login: FAKE_LOGIN });
  await page.getByRole('button', { name: 'Refresh artboards' }).click();
  await expect(page.getByTestId('artboards-unavailable')).toContainText("Claude Design isn't available for this Claude login");
});
