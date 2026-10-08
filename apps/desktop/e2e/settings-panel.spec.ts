import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { Settings } from '@agent-lanes/contracts';

/**
 * The settings panel (AL-146) in the real app: opened from the board header, it edits the agent
 * defaults and a registered repo, shows the repo's detected commands (AL-130), and saves through
 * `settings:update` into `<userData>/settings.json`.
 */

let userDataDir: string;
let repoPath: string;
let app: ElectronApplication | undefined;

async function launch(): Promise<Page> {
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));
  await expect(page.getByText('Agent board')).toBeVisible();
  return page;
}

function savedSettings(): Settings {
  return JSON.parse(readFileSync(join(userDataDir, 'settings.json'), 'utf8')) as Settings;
}

test.beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-settings-panel-'));
  repoPath = join(userDataDir, 'web-shop');
  mkdirSync(repoPath);
  writeFileSync(join(repoPath, 'package.json'), JSON.stringify({ name: 'web-shop', scripts: { build: 'tsc -b', start: 'node server.js' } }));
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({
      version: 2,
      repos: [
        {
          path: repoPath,
          name: 'web-shop',
          baseBranch: 'main',
          worktreeRoot: join(userDataDir, '.agent-lanes'),
          buildCommand: null,
          runCommand: null,
          maxConcurrentAgents: 3,
        },
      ],
    }),
  );
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(userDataDir, { recursive: true, force: true });
});

test('edits agent defaults and a repo from the board header and saves them', async () => {
  const page = await launch();

  await page.getByRole('button', { name: 'Settings' }).click();
  const panel = page.getByRole('dialog', { name: 'Settings' });
  await expect(panel).toBeVisible();

  await panel.getByRole('radio', { name: 'Sonnet' }).click();
  await panel.getByRole('switch', { name: 'QA Auto' }).click();
  await panel.getByTestId('settings-build-queue-size').fill('3');
  await panel.getByRole('switch', { name: /^Move work items/ }).click();
  await page.screenshot({ path: test.info().outputPath('settings-defaults.png') });

  await panel.getByRole('tab', { name: 'Repos' }).click();
  await expect(panel.getByText('Leave empty to use the detected command: npm run build')).toBeVisible();
  await panel.getByTestId('settings-repo-base-branch').fill('develop');
  await panel.getByTestId('settings-repo-build-command').fill('npm run build:prod');
  await panel.getByRole('switch', { name: 'Post stage comments to Azure DevOps On' }).click();
  await page.screenshot({ path: test.info().outputPath('settings-repo.png') });

  await panel.getByRole('button', { name: 'Save settings' }).click();
  await expect(panel).toBeHidden();

  await expect.poll(() => savedSettings().buildQueueSize).toBe(3);
  expect(savedSettings()).toMatchObject({
    adoStateTransitions: true,
    defaults: { model: 'sonnet', stageGates: { qa: 'approval' } },
    repos: [{ path: repoPath, baseBranch: 'develop', buildCommand: 'npm run build:prod', adoWriteBack: false }],
  });

  // Opened again, the panel shows what was saved.
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(panel.getByTestId('settings-build-queue-size')).toHaveValue('3');
  await expect(panel.getByRole('radio', { name: 'Sonnet' })).toHaveAttribute('aria-checked', 'true');
});

test('sets the agents team board drops start, per lane, on the Drops tab (AL-240)', async () => {
  const page = await launch();
  await page.getByRole('button', { name: 'Settings' }).click();
  const panel = page.getByRole('dialog', { name: 'Settings' });
  await panel.getByRole('tab', { name: 'Drops' }).click();

  const qa = panel.getByTestId('settings-drop-qa');
  await expect(panel.getByTestId('settings-drop-code-review-skills')).toHaveValue('/code-review /pr-comment-actioner');
  await expect(qa.getByRole('radio', { name: 'Sonnet' })).toHaveAttribute('aria-checked', 'true');
  await panel.getByTestId('settings-drop-qa-skills').fill('/cs-qa-wip /cs-smoke');
  await qa.getByRole('radio', { name: 'Haiku' }).click();
  await page.screenshot({ path: test.info().outputPath('settings-drops.png') });
  await panel.getByRole('button', { name: 'Save settings' }).click();
  await expect(panel).toBeHidden();

  await expect.poll(() => savedSettings().dropDefaults?.qa).toEqual({ skills: ['cs-qa-wip', 'cs-smoke'], model: 'haiku', effort: 'medium' });
  expect(savedSettings().dropDefaults?.['code-review']).toEqual({ skills: ['code-review', 'pr-comment-actioner'], model: 'opus', effort: 'high' });
});
