import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';

/** AL-131: the build job queue answers the renderer over IPC. Jobs themselves come with AL-132/AL-133. */
test.describe('build job queue', () => {
  let app: ElectronApplication;
  let userDataDir: string;

  test.beforeAll(async () => {
    userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-build-queue-'));
    app = await electron.launch({
      args: [join(__dirname, '..')],
      env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
    });
  });

  test.afterAll(async () => {
    await app?.close();
    rmSync(userDataDir, { recursive: true, force: true });
  });

  function invoke(page: Page, channel: string, payload?: unknown): Promise<unknown> {
    return page.evaluate(
      ([name, body]) => {
        const bridge = (globalThis as { agentLanes?: { invoke(channel: string, payload?: unknown): Promise<unknown> } }).agentLanes;
        return bridge?.invoke(name as string, body);
      },
      [channel, payload] as const,
    );
  }

  test('lists an empty queue that runs two jobs at once', async () => {
    const page = await app.firstWindow();
    await expect(page.getByText('Agent board')).toBeVisible();

    await expect(invoke(page, 'build:listJobs')).resolves.toEqual({ ok: true, data: { concurrency: 2, jobs: [] } });
  });

  test('cancelling a job that is not queued changes nothing', async () => {
    const page = await app.firstWindow();

    await expect(invoke(page, 'build:cancel', { jobId: 'no-such-job' })).resolves.toEqual({ ok: true, data: { cancelled: false } });
    await expect(invoke(page, 'build:cancel', {})).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
  });
});
