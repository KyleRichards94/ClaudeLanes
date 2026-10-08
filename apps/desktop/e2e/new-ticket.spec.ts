import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { RepoSettings } from '@agent-lanes/contracts';

/**
 * New agent ticket (AL-160) in the real app, driven with the keyboard only: Tab to "+ New agent
 * ticket", open it, choose "No ticket", describe the job, Tab to "Launch agent" and press Enter.
 * Launch itself (AL-165) is in `launch.spec.ts`; here no repo or Claude connection is set up, so
 * Launch says what is missing and the modal stays open.
 */

let userDataDir: string;
let app: ElectronApplication | undefined;

test.beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-new-ticket-'));
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(userDataDir, { recursive: true, force: true });
});

/** What the focused element is called: its aria-label, else its placeholder, else its text. */
function focusedName(page: Page): Promise<string> {
  // A string, because the e2e project has no DOM types.
  return page.evaluate<string>(`(() => {
    const element = document.activeElement;
    return element?.getAttribute('aria-label') ?? element?.getAttribute('placeholder') ?? element?.textContent?.trim() ?? '';
  })()`);
}

async function tabTo(page: Page, name: string | RegExp): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    const current = await focusedName(page);
    if (typeof name === 'string' ? current === name : name.test(current)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error(`Tab never reached ${String(name)} (focus is on "${await focusedName(page)}")`);
}

test('goes from the board to a launched request with the keyboard only', async () => {
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));
  await expect(page.getByText('Agent board')).toBeVisible();

  await tabTo(page, 'New agent ticket');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'New agent ticket' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Linked to|No work item picked yet/)).toBeVisible();

  await tabTo(page, 'Sprint');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(dialog.getByRole('radio', { name: 'No ticket' })).toHaveAttribute('aria-checked', 'true');

  await tabTo(page, /^Describe the job/);
  await page.keyboard.type('Fix the supplier portal login redirect loop');
  await page.screenshot({ path: test.info().outputPath('new-ticket.png') });

  await tabTo(page, 'Launch agent');
  await page.keyboard.press('Enter');

  // No repo is registered in this profile: Launch says so and keeps the form.
  await expect(dialog.getByText(/^Add a repo in Settings before launching an agent/)).toBeVisible();
  await expect(dialog).toBeVisible();
});

test('previews the workspace, blocks Launch on an invalid worktree name and keeps the stage gates (AL-164)', async () => {
  // A real repo with a main branch, registered in the profile (repos are only added through the folder picker).
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-workspace-')));
  try {
    const repo = join(root, 'onsite-companion');
    mkdirSync(repo);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
    git('init', '--quiet', '--initial-branch=main');
    git('-c', 'user.name=Agent Lanes', '-c', 'user.email=e2e@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'Initial');
    const repoSettings: RepoSettings = {
      path: repo,
      name: 'onsite-companion',
      baseBranch: 'main',
      worktreeRoot: join(root, '.agent-lanes'),
      buildCommand: null,
      runCommand: null,
      maxConcurrentAgents: 4,
    };
    writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ version: 2, repos: [repoSettings] }));

    app = await electron.launch({ args: [join(__dirname, '..')], env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir } });
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));
    await expect(page.getByText('Agent board')).toBeVisible();
    await page.getByRole('button', { name: 'New agent ticket' }).click();
    const dialog = page.getByRole('dialog', { name: 'New agent ticket' });
    await expect(dialog).toBeVisible();

    // Model cards and gates (AL-163, AL-164).
    await expect(dialog.getByRole('radio', { name: 'Opus' })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByText('Deepest reasoning')).toBeVisible();
    await expect(dialog.getByRole('switch', { name: /^Planning/ })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByRole('switch', { name: /^Create PR/ })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByRole('switch', { name: /^QA/ })).toHaveAttribute('aria-checked', 'false');

    await dialog.getByRole('radio', { name: 'No ticket' }).click();
    await dialog.getByRole('textbox', { name: 'What should the agent do?' }).fill('Fix the supplier portal login');
    await expect(dialog.getByTestId('workspace-repo')).toHaveText('onsite-companion');
    await expect(dialog.getByTestId('workspace-base')).toHaveText('main');
    const worktree = dialog.getByRole('textbox', { name: 'Worktree' });
    await expect(worktree).toHaveValue(/^nt-\d{8}-fix-the-supplier$/);
    await page.screenshot({ path: test.info().outputPath('workspace.png') });

    // An invalid name blocks Launch with the reason; so does an existing branch.
    await worktree.fill('fix login');
    await dialog.getByRole('button', { name: 'Launch agent' }).click();
    await expect(dialog.getByTestId('workspace-error')).toHaveText("Branch names can't contain spaces.");
    await expect(worktree).toBeFocused();
    await worktree.fill('main');
    await expect(dialog.getByTestId('workspace-error')).toHaveText('A branch named "main" already exists.');
    const launch = dialog.getByRole('button', { name: 'Launch agent' });
    await launch.click();
    // Launch asks main about the name, then stays open.
    await expect(launch).not.toHaveAttribute('aria-busy', 'true');
    await expect(dialog).toBeVisible();

    await worktree.fill('fix-supplier-login');
    await expect(dialog.getByTestId('workspace-error')).toBeHidden();
    await dialog.getByRole('button', { name: 'Launch agent' }).click();
    // Claude is not connected in this profile, so the launch is refused and rolled back (AL-165).
    await expect(dialog.getByText('Connect Claude in Connections before starting an agent.')).toBeVisible({ timeout: 30_000 });
    await expect(dialog).toBeVisible();
  } finally {
    await app?.close();
    app = undefined;
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
