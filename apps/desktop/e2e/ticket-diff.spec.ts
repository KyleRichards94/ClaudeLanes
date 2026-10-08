import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { e2eTicketRecord, seedTicketRecords } from './support/ticket-records';

/**
 * AL-179: the drill-in's Diff tab against a real git repository and ticket worktree. The file list
 * comes from `git:diff`; a file's lines only from `git:diffFile` once its row is opened.
 */

let app: ElectronApplication;
let page: Page;
let root: string;

test.describe.configure({ mode: 'serial' });

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore' });
}

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-ticket-diff-'));
  const repo = join(root, 'onsite-companion');
  const worktree = join(root, '.agent-lanes', '71273');
  const userDataDir = join(root, 'profile');
  mkdirSync(repo);
  mkdirSync(userDataDir);

  git(repo, 'init', '-b', 'main');
  writeFileSync(join(repo, 'frmJobControl.vb'), 'Imports System\nPublic Class frmJobControl\nEnd Class\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'base');
  git(repo, 'worktree', 'add', '-b', '71273-cutover-job-control', worktree, 'main');
  writeFileSync(join(worktree, 'frmJobControl.vb'), 'Imports System\nPublic Class frmJobControlLegacy\nEnd Class\n');
  writeFileSync(join(worktree, 'JobControl.razor'), '@page "/jobs"\n<JobGrid />\n');
  git(worktree, 'add', 'frmJobControl.vb');
  git(worktree, 'commit', '-m', 'cutover');

  seedTicketRecords(userDataDir, [e2eTicketRecord({ ado: null, repo, worktreePath: worktree })]);
  app = await electron.launch({ args: [join(__dirname, '..')], env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir } });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(root, { recursive: true, force: true });
});

test('lists the ticket branch changes and loads a file diff when it is opened', async () => {
  await page.evaluate("window.location.hash = '#/ticket/71273'");
  await page.getByRole('tab', { name: 'Diff' }).click();

  const tab = page.getByTestId('ticket-tab-diff');
  await expect(tab.getByTestId('diff-file')).toHaveCount(2, { timeout: 15_000 });
  await expect(tab.getByTestId('diff-totals')).toHaveText('2 files · +3 −1');
  await expect(tab.getByText('Includes uncommitted changes')).toBeVisible();
  await expect(tab.getByTestId('diff-file-lines')).toHaveCount(0);

  await tab.getByTestId('diff-file-frmJobControl.vb').click();
  const lines = tab.getByTestId('diff-file-lines');
  await expect(lines.getByTestId('diff-line-remove')).toContainText('Public Class frmJobControl');
  await expect(lines.getByTestId('diff-line-add')).toContainText('Public Class frmJobControlLegacy');
  await tab.screenshot({ path: test.info().outputPath('diff-tab.png') });
});
