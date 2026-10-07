import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';

/** The environment of this test run with a PATH that holds no git. */
function envWithoutGit(emptyDir: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key.toUpperCase() !== 'PATH') env[key] = value;
  }
  const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows';
  env['PATH'] = process.platform === 'win32' ? `${systemRoot}\\System32;${systemRoot}` : emptyDir;
  return env;
}

/**
 * The warning is a window-modal native dialog, which Playwright cannot read; while one is open
 * Windows disables its parent, so `isEnabled()` tells whether the app is showing it.
 */
function windowsEnabled(app: ElectronApplication): Promise<boolean[]> {
  return app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((window) => window.isEnabled()));
}

/** AL-080: the start-up git check warns over the window instead of breaking start-up. */
test.describe('git version check', () => {
  let app: ElectronApplication | undefined;
  const dirs: string[] = [];

  async function launch(env: Record<string, string | undefined>): Promise<ElectronApplication> {
    const userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-git-'));
    dirs.push(userDataDir);
    app = await electron.launch({ args: [join(__dirname, '..')], env: { ...env, AGENT_LANES_USER_DATA_DIR: userDataDir } });
    return app;
  }

  test.afterEach(async () => {
    await app?.close();
    app = undefined;
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test('starts normally with no git on PATH and shows the warning over the board', async () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-nopath-'));
    dirs.push(emptyDir);
    const running = await launch(envWithoutGit(emptyDir));

    const page = await running.firstWindow();
    await expect(page.getByText('Agent board')).toBeVisible();

    test.skip(process.platform !== 'win32', 'window-modal state is only observable this way on Windows');
    await expect.poll(() => windowsEnabled(running)).toEqual([false]);
  });

  test('shows no warning when git is installed', async () => {
    const running = await launch(process.env);

    const page = await running.firstWindow();
    await expect(page.getByText('Agent board')).toBeVisible();

    test.skip(process.platform !== 'win32', 'window-modal state is only observable this way on Windows');
    // Give the check (one `git --version`) time to finish, then confirm nothing took the window over.
    await page.waitForTimeout(2_000);
    expect(await windowsEnabled(running)).toEqual([true]);
  });
});
