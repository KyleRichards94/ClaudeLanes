import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { e2eTicketRecord, seedTicketRecords } from './support/ticket-records';

/**
 * AL-284: the ticket screen's two layouts in the real app. The reference ticket (fixtures/ticket-11726.json: five
 * changed files) is built as a git repository and ticket worktree. Flight deck is the default; the header slider
 * switches to Code City, where the tallest building is FailedSyncFiles.razor (+120 −0) and picking it fills the
 * inspector; the choice survives a restart.
 */

interface FixtureFile {
  path: string;
  before: number;
  kept: number;
  added: number;
  removed: number;
}
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'ticket-11726.json'), 'utf8')) as { files: FixtureFile[] };

let app: ElectronApplication;
let page: Page;
let root: string;
let userDataDir: string;

test.describe.configure({ mode: 'serial' });

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'ignore' });
}

const lines = (prefix: string, count: number) => Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);
const write = (file: string, content: string[]) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content.length === 0 ? '' : `${content.join('\n')}\n`);
};

async function launch(): Promise<void> {
  app = await electron.launch({ args: [join(__dirname, '..')], env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir } });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
  await page.evaluate("window.location.hash = '#/ticket/71273'");
  await expect(page.getByTestId('ticket-title')).toBeVisible();
}

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-ticket-layouts-'));
  const repo = join(root, 'onsite-companion');
  const worktree = join(root, '.agent-lanes', '71273');
  userDataDir = join(root, 'profile');
  mkdirSync(repo);
  mkdirSync(userDataDir);

  git(repo, 'init', '-b', 'main');
  writeFileSync(join(repo, 'README.md'), 'OnSite Companion\n');
  for (const file of fixture.files) if (file.before > 0) write(join(repo, file.path), lines('old', file.before));
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'base');
  git(repo, 'worktree', 'add', '-b', '71273-cutover-job-control', worktree, 'main');
  for (const file of fixture.files) {
    // Keep the tail of the old lines, then add new ones: `removed` old lines go, `added` new ones arrive.
    const kept = lines('old', file.before).slice(file.before - file.kept);
    write(join(worktree, file.path), [...kept, ...lines('new', file.added)]);
  }
  git(worktree, 'add', '.');
  git(worktree, 'commit', '-m', 'failed sync files');

  seedTicketRecords(userDataDir, [e2eTicketRecord({ ado: null, repo, worktreePath: worktree, sessionId: null })]);
  await launch();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(root, { recursive: true, force: true });
});

test('opens in Flight deck: the change map has a tile per changed file', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900));
  const slider = page.getByRole('radiogroup', { name: 'Ticket layout' });
  await expect(slider.getByRole('radio', { name: 'Flight deck' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('workflow-card').or(page.getByTestId('ticket-stepper-band'))).toBeVisible();
  await expect(page.getByTestId('change-map').getByRole('button')).toHaveCount(5, { timeout: 15_000 });
  await expect(page.getByTestId('diff-totals')).toHaveText('5 files · +231 −47');
  await page.screenshot({ path: test.info().outputPath('flight-deck.png') });
});

test('the slider switches to Code City, where the tallest building opens its file in the inspector', async () => {
  const slider = page.getByRole('radiogroup', { name: 'Ticket layout' });
  await slider.getByRole('radio', { name: 'Code city' }).click();

  const city = page.getByRole('listbox', { name: 'Changed files' });
  await expect(city.getByRole('option')).toHaveCount(5, { timeout: 15_000 });

  // The tallest building: FailedSyncFiles.razor, +120 −0. Picked from the keyboard (the 3D plane is hit-tested through its transforms).
  const tallest = city.getByRole('option', { name: /^FailedSyncFiles.razor,.*120 lines added, 0 removed/ });
  await expect(tallest).toHaveCount(1);
  await tallest.focus();
  await page.keyboard.press('Enter');

  const inspector = page.getByTestId('city-inspector');
  await expect(inspector).toContainText('FailedSyncFiles.razor');
  await expect(page.getByTestId('city-stat-added')).toContainText('+120');
  await expect(page.getByTestId('city-stat-removed')).toContainText('−0');
  // The layout swap takes 280 ms (80 ms delay): let it finish before the picture.
  await page.waitForTimeout(700);
  await page.screenshot({ path: test.info().outputPath('code-city.png') });
});

test('the blueprint diff expands beside the city between two dividers', async () => {
  await page.getByTestId('city-diff-expand').click();
  await expect(page.getByRole('separator', { name: 'Resize the city and the blueprint diff' })).toBeVisible();
  await expect(page.getByRole('separator', { name: 'Resize the blueprint diff and the inspector' })).toBeVisible();
  await expect(page.getByTestId('city-diff-pane').getByTestId('diff-file-lines').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('city-rail').getByTestId('city-diff')).toHaveCount(0);
  await page.waitForTimeout(400);
  await page.screenshot({ path: test.info().outputPath('code-city-expanded.png') });
  await page.getByRole('button', { name: 'Move the blueprint diff back to the rail' }).click();
  await expect(page.getByTestId('city-rail').getByTestId('city-diff')).toBeVisible();
});

test('the selected file carries back to Flight deck, and the choice survives a restart', async () => {
  const slider = page.getByRole('radiogroup', { name: 'Ticket layout' });
  await slider.getByRole('radio', { name: 'Flight deck' }).click();
  await expect(page.getByTestId('diff-file-path')).toHaveText(/FailedSyncFiles.razor$/);

  await slider.getByRole('radio', { name: 'Code city' }).click();
  await app.close();
  await launch();
  await expect(page.getByRole('radiogroup', { name: 'Ticket layout' }).getByRole('radio', { name: 'Code city' })).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 });
  await expect(page.getByRole('listbox', { name: 'Changed files' })).toBeVisible();
});
