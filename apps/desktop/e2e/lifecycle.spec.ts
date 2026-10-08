import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

/**
 * App lifecycle (AL-213): the main window opens where it was left on the last quit, and quitting with
 * no agent mid-turn asks nothing and stops cleanly. Process clean-up on quit is covered by
 * run-job.spec.ts (runs) and the main-process tests (sessions, builds, other `claude` processes).
 */

let app: ElectronApplication | undefined;
let root: string;
let userDataDir: string;

async function launch(): Promise<ElectronApplication> {
  app = await electron.launch({ args: [join(__dirname, '..')], env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir } });
  const page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
  return app;
}

function mainWindowBounds(running: ElectronApplication) {
  return running.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    return { bounds: window.getNormalBounds(), maximized: window.isMaximized() };
  });
}

test.beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-lifecycle-'));
  userDataDir = join(root, 'user-data');
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(root, { recursive: true, force: true, maxRetries: 5 });
});

test('the window reopens at the size and position it was closed at (AL-213)', async () => {
  const first = await launch();
  // The first launch has nothing saved: the default size.
  expect((await mainWindowBounds(first)).bounds).toMatchObject({ width: 1440, height: 960 });

  const target = await first.evaluate(({ BrowserWindow, screen }) => {
    const area = screen.getPrimaryDisplay().workArea;
    const bounds = { x: area.x + 40, y: area.y + 30, width: 1200, height: 760 };
    BrowserWindow.getAllWindows()[0]!.setBounds(bounds);
    return bounds;
  });
  await expect.poll(async () => (await mainWindowBounds(first)).bounds).toEqual(target);

  // Quitting with no agent mid-turn asks nothing, and saves where the window was.
  await first.close();
  app = undefined;
  const stateFile = join(userDataDir, 'window-state.json');
  expect(existsSync(stateFile)).toBe(true);
  expect(JSON.parse(readFileSync(stateFile, 'utf8'))).toEqual({ version: 1, bounds: target, maximized: false });

  const second = await launch();
  expect(await mainWindowBounds(second)).toEqual({ bounds: target, maximized: false });
});
