import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { FAKE_LOGIN, fakeClaudeEnv, writeFakeClaudeState } from './support/fake-claude-code';
import { startFakeClaudeSite } from './support/fake-claude-site';
import { e2eTicketRecord, seedTicketRecords } from './support/ticket-records';

/**
 * AL-196: the in-app design thread (MCP link mode). The design session runs the fake `claude` binary,
 * which answers each message from its state file; the canvas is a local stand-in for claude.ai.
 * Nothing leaves the machine.
 */

let site: Awaited<ReturnType<typeof startFakeClaudeSite>>;
let userDataDir: string;
let app: ElectronApplication | undefined;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  site = await startFakeClaudeSite();
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-design-thread-'));
  writeFakeClaudeState(join(userDataDir, 'fake-claude.json'), {
    login: FAKE_LOGIN,
    design: { artboards: [{ id: 'job-control.html', name: 'JobControl · desktop', width: 1440, height: 900 }], reply: 'Design side: {prompt}' },
  });
  const canvas = { kind: 'design-project' as const, id: 'canvas-a', url: 'https://claude.ai/design/p/canvas-a' };
  // The ticket is still Planning: the design thread works at every stage (R11).
  const start = 1_760_000_000_000;
  seedTicketRecords(userDataDir, [
    e2eTicketRecord({
      stage: 'planning',
      stageHistory: [
        { stage: 'queued', at: start },
        { stage: 'planning', at: start + 60_000 },
      ],
      design: { canvas, lastViewUrl: null, specs: [] },
    }),
  ]);
});

test.afterAll(async () => {
  await app?.close();
  await site?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

async function launch(): Promise<Page> {
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: {
      ...process.env,
      AGENT_LANES_USER_DATA_DIR: userDataDir,
      AGENT_LANES_DESIGN_TEST_ORIGIN: site.origin,
      ...fakeClaudeEnv(join(userDataDir, 'fake-claude.json')),
    },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));
  await expect(page.getByText('Agent board')).toBeVisible();
  await page.evaluate(() => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = '#/ticket/71273/design';
  });
  return page;
}

/** The design session the thread resumes after a restart, from its saved file (D8: app data). */
function savedSessionId(): string | null {
  const file = join(userDataDir, 'design-threads', '71273.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { sessionId: string | null }).sessionId : null;
}

test('talks to the design side during Planning, and keeps the thread across tab switches', async () => {
  const page = await launch();
  // Webview mode: the canvas's own chat is the thread.
  await expect(page.getByTestId('design-thread-canvas-chat')).toBeVisible();

  await page.getByRole('radio', { name: 'MCP link, Open in Claude, sync via MCP' }).click();
  const input = page.getByRole('textbox', { name: 'Message to the design side' });
  await input.fill('Make the filter panel narrower');
  await page.getByRole('button', { name: 'Send to design' }).click();

  const thread = page.getByRole('log', { name: 'Design thread messages' });
  await expect(thread.getByText('Design side: Make the filter panel narrower')).toBeVisible();
  await expect(thread.getByTestId('design-thread-user')).toHaveCount(1);
  await expect(input).toHaveValue('');

  await page.getByRole('tab', { name: 'Output' }).click();
  await expect(page.getByTestId('design-tab-page')).toBeHidden();
  await page.getByRole('tab', { name: /Claude Design/ }).click();
  await expect(page.getByRole('log', { name: 'Design thread messages' }).getByText('Design side: Make the filter panel narrower')).toBeVisible();
});

test('keeps the thread after a restart and resumes the same design session', async () => {
  await app!.close();
  app = undefined;
  const firstSession = savedSessionId();
  expect(firstSession).toMatch(/^[0-9a-f-]{36}$/);

  const page = await launch();
  const thread = page.getByRole('log', { name: 'Design thread messages' });
  await expect(thread.getByText('Design side: Make the filter panel narrower')).toBeVisible();

  await page.getByRole('textbox', { name: 'Message to the design side' }).fill('And the header?');
  await page.getByRole('button', { name: 'Send to design' }).click();
  await expect(thread.getByText('Design side: And the header?')).toBeVisible();
  await expect(thread.getByTestId('design-thread-reply')).toHaveCount(2);

  // The fake keeps the session id it is resumed with (`--resume`) and makes a new one otherwise.
  await app!.close();
  app = undefined;
  expect(savedSessionId()).toBe(firstSession);
});
