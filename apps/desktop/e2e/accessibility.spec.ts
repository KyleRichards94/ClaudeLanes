import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { auditTargets, seriousAxeViolations } from './support/accessibility';

/**
 * AL-033 on the production build: the board has no serious axe violations and no control smaller
 * than 44 px. The gallery and its modals are checked in gallery.spec.ts.
 */
let app: ElectronApplication;
let page: Page;
let userDataDir: string;

test.beforeAll(async () => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-'));
  app = await electron.launch({ args: [join(__dirname, '..')], env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir } });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('the board has no serious axe violations', async () => {
  expect(await seriousAxeViolations(page)).toEqual([]);
});

test('every control on the board is at least 44 × 44 px', async () => {
  expect((await auditTargets(page)).small).toEqual([]);
});
