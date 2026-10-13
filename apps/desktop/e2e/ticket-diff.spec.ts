import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { e2eTicketRecord, seedTicketRecords } from './support/ticket-records';

/**
 * AL-179, AL-279: the drill-in's diff column against a real git repository and ticket worktree. The change map
 * comes from `diff:files`; a file's lines only from `git:diffFile` once it is the one shown.
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

test('shows the ticket branch changes as a change map beside the output, each tile opening the diff of its file', async () => {
  await page.evaluate("window.location.hash = '#/ticket/71273'");
  // Output & diff: the diff column is beside the output, open by default.
  await expect(page.getByRole('tab', { name: 'Output & diff' })).toHaveAttribute('aria-selected', 'true');

  const column = page.getByTestId('ticket-tab-diff');
  await expect(column.getByTestId('change-map').getByRole('button')).toHaveCount(2, { timeout: 15_000 });
  await expect(column.getByTestId('diff-totals')).toHaveText('2 files · +3 −1');
  await expect(column.getByText('Includes uncommitted changes')).toBeVisible();

  // A tile opens its file; the lines come from git:diffFile. (With nothing picked, the file that changed most is open.)
  await column.getByTestId('change-tile-frmJobControl.vb').click();
  await expect(column.getByTestId('diff-file-path')).toHaveText('frmJobControl.vb');
  const lines = column.getByTestId('diff-file-lines');
  await expect(lines.getByTestId('diff-line-remove')).toContainText('Public Class frmJobControl');
  await expect(lines.getByTestId('diff-line-add')).toContainText('Public Class frmJobControlLegacy');

  // The other file; with no recorded author here, it is the grey "you or a merge".
  await column.getByTestId('change-tile-JobControl.razor').click();
  await expect(column.getByTestId('diff-file-path')).toHaveText('JobControl.razor');
  await expect(column.getByTestId('diff-file-author')).toHaveText('by you or a merge');
  await expect(lines.getByTestId('diff-line-add').first()).toContainText('@page');
  await column.screenshot({ path: test.info().outputPath('diff-column.png') });
});
