import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

let app: ElectronApplication;
let userDataDir: string;

test.beforeAll(async () => {
  // A fresh profile per run: no real connections, and no clash with an Agent Lanes window already open.
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-'));
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('opens the board and reaches the main process over IPC', async () => {
  const page = await app.firstWindow();

  await expect(page).toHaveTitle('Agent Lanes');
  await expect(page.getByText('Agent board')).toBeVisible();
  await expect(page.getByTestId('runtime-info')).toContainText('v0.1.0 · Electron');

  await page.screenshot({ path: join(__dirname, '..', 'test-results', 'smoke-board.png') });
});

test('keeps Node out of the renderer', async () => {
  const page = await app.firstWindow();
  const exposed = await page.evaluate(() => {
    const scope = globalThis as { require?: unknown; process?: unknown; agentLanes?: object };
    return {
      require: typeof scope.require,
      process: typeof scope.process,
      bridge: Object.keys(scope.agentLanes ?? {}).sort(),
    };
  });

  expect(exposed).toEqual({ require: 'undefined', process: 'undefined', bridge: ['invoke', 'on'] });
});

test('uses the throwaway profile', async () => {
  const userData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
  expect(userData).toBe(userDataDir);
});
