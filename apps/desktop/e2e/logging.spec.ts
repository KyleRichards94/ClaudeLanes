import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/**
 * AL-214: the main-process log lives in the profile's `logs` folder, every line is redacted, and
 * "Copy diagnostics" is built from it. The PAT below is made up and reaches the app the way a
 * developer's shell token would: through the environment.
 */
const FAKE_PAT = 'e2epat0000fake1111only2222never3333real4444Zq9Wx7Lm';

test.describe('logging and diagnostics', () => {
  let app: ElectronApplication;
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-logging-'));
    app = await electron.launch({
      args: [join(__dirname, '..')],
      env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir, AZURE_DEVOPS_EXT_PAT: FAKE_PAT },
    });
  });

  test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  const logDir = () => join(userDataDir, 'logs');

  function readLogs(): string {
    if (!existsSync(logDir())) return '';
    return readdirSync(logDir())
      .map((name) => readFileSync(join(logDir(), name), 'utf8'))
      .join('\n');
  }

  function invoke(page: Page, channel: string, payload?: unknown): Promise<unknown> {
    return page.evaluate(
      ([name, body]) => (globalThis as unknown as { agentLanes: { invoke(c: string, p?: unknown): Promise<unknown> } }).agentLanes.invoke(name, body),
      [channel, payload] as const,
    );
  }

  test('writes main.log in the profile, starting with a start-up line', async () => {
    const page = await app.firstWindow();
    await expect(page.getByText('Agent board')).toBeVisible();

    await expect.poll(readLogs).toMatch(/^\S+Z INFO {2}\[main\] Agent Lanes 0\.1\.0 starting /);
    expect(existsSync(join(logDir(), 'main.log'))).toBe(true);
  });

  test('logs renderer errors with the PAT redacted', async () => {
    const page = await app.firstWindow();
    const basicAuth = Buffer.from(`:${FAKE_PAT}`).toString('base64');

    const bundle = pathToFileURL(join(__dirname, '..', 'out', 'renderer', 'assets', 'index.js')).href;

    const result = await invoke(page, 'app:logError', {
      source: 'window',
      name: 'Error',
      message: `ADO call failed with ${FAKE_PAT}`,
      stack: `Error: ADO call failed\n    at fetch (Authorization: Basic ${basicAuth})\n    at load (${bundle}:12:34)`,
    });
    expect(result).toEqual({ ok: true, data: null });

    // A real uncaught error in the page reaches the log through the renderer's error reporting.
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('e2e uncaught renderer error');
      }, 0);
    });

    await expect.poll(readLogs).toContain('ERROR [renderer] Uncaught Error: ADO call failed with [REDACTED]');
    await expect.poll(readLogs).toContain('ERROR [renderer] Uncaught Error: e2e uncaught renderer error');
    const text = readLogs();
    expect(text).toContain('Authorization: Basic [REDACTED]');
    expect(text).not.toContain(FAKE_PAT);
    expect(text).not.toContain(basicAuth);
    // Redaction must not eat ordinary paths (the app folder is often in the environment as PWD).
    expect(text).toContain(`    at load (${bundle}:12:34)`);
  });

  test('diagnostics list versions and recent errors, and never the PAT', async () => {
    const page = await app.firstWindow();
    const result = (await invoke(page, 'app:getDiagnostics')) as { ok: boolean; data: { text: string; recentErrors: unknown[] } };

    expect(result.ok).toBe(true);
    expect(result.data.text).toContain('Agent Lanes diagnostics');
    expect(result.data.text).toMatch(/Electron \d+\.\d+\.\d+ · Chrome \S+ · Node \S+/);
    expect(result.data.text).toContain('Uncaught Error: ADO call failed with [REDACTED]');
    expect(result.data.recentErrors.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(result)).not.toContain(FAKE_PAT);
  });
});
