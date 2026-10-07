import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { ADO_FIXTURE_PAT } from '@agent-lanes/ado-client/testing';
import { ADO_FIXTURE_IDENTITY } from '@agent-lanes/contracts/testing';
import { startFakeAdoServer, type FakeAdoServer } from './support/fake-ado-server';

/**
 * AL-047 in the real app on a fresh profile: the board can't be reached until an Azure DevOps
 * organisation and Claude are connected and a repo is picked; the next launch opens straight on the
 * board for that repo. Azure DevOps is the shared fake organisation on 127.0.0.1, Claude Code is the
 * fake `claude` (e2e/fixtures/fake-claude-code.mjs, logged in), and the folder picker is scripted.
 * The other specs skip first run (playwright.config.ts); this one takes the skip out.
 */

const FAKE_CLAUDE = join(__dirname, 'fixtures', 'fake-claude-code.mjs');
const LOGIN = { email: 'kyle@example.test', organization: 'Companion Systems', subscriptionType: 'team' };

let dir: string;
let repoDir: string;
let ado: FakeAdoServer;
let app: ElectronApplication | undefined;

function git(args: string[], cwd: string): void {
  execFileSync('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'),
      GIT_AUTHOR_NAME: 'Agent Lanes Test',
      GIT_AUTHOR_EMAIL: 'test@agent-lanes.invalid',
      GIT_COMMITTER_NAME: 'Agent Lanes Test',
      GIT_COMMITTER_EMAIL: 'test@agent-lanes.invalid',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
}

async function launch(): Promise<Page> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && key !== 'AGENT_LANES_SKIP_FIRST_RUN') env[key] = value;
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: {
      ...env,
      AGENT_LANES_USER_DATA_DIR: join(dir, 'profile'),
      AGENT_LANES_CLAUDE_EXECUTABLE: FAKE_CLAUDE,
      AGENT_LANES_FAKE_CLAUDE_STATE: join(dir, 'fake-claude-state.json'),
    },
  });
  // The folder picker returns the fixture repo.
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog;
  }, repoDir);
  return app.firstWindow();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-first-run-')));
  writeFileSync(join(dir, 'fake-claude-state.json'), JSON.stringify({ login: LOGIN, apiKeys: [], log: join(dir, 'fake-claude.jsonl') }));
  repoDir = join(dir, 'OnSiteCompanion');
  mkdirSync(repoDir);
  git(['init', '--quiet', '--initial-branch=main'], repoDir);
  writeFileSync(join(repoDir, 'README.md'), '# fixture\n');
  git(['add', '--all'], repoDir);
  git(['-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Initial commit'], repoDir);
  ado = await startFakeAdoServer();
});

test.afterAll(async () => {
  await app?.close();
  await ado?.close();
  rmSync(dir, { recursive: true, force: true });
});

test('a fresh profile reaches the board only after Azure DevOps, Claude and a repo', async () => {
  const page = await launch();
  const connections = page.getByRole('dialog', { name: 'Connections' });
  await expect(connections).toBeVisible();
  await expect(page.getByTestId('connections-first-run')).toBeVisible();
  // Blocking: no close button, no Cancel, Esc does nothing, and the board behind takes no clicks.
  await expect(connections.getByRole('button', { name: 'Close' })).toHaveCount(0);
  await expect(page.getByTestId('connections-cancel')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(connections).toBeVisible();
  await expect(page.getByTestId('open-connections').click({ trial: true, timeout: 1_000 })).rejects.toThrow();

  // Azure DevOps alone is not enough.
  await page.getByTestId('ado-org-url').fill(ado.orgUrl);
  await page.getByTestId('ado-pat').fill(ADO_FIXTURE_PAT);
  await page.getByTestId('ado-test-connection').click();
  await expect(page.getByTestId('ado-test-outcome')).toContainText(`signed in as ${ADO_FIXTURE_IDENTITY}`);
  await page.getByTestId('connections-save').click();
  await expect(page.getByTestId('connection-ado:contoso')).toBeVisible();
  await expect(connections).toBeVisible();

  // Claude: the login the fake reports.
  await page.getByRole('tab', { name: /^Claude/ }).click();
  await expect(page.getByTestId('claude-detection')).toContainText('kyle@example.test (Companion Systems)');
  await page.getByTestId('claude-test-connection').click();
  await expect(page.getByTestId('claude-test-outcome')).toContainText('Connection works');
  await page.getByTestId('connections-save').click();

  // Then the repo.
  const pick = page.getByRole('dialog', { name: 'Pick a repo' });
  await expect(pick).toBeVisible();
  await expect(connections).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(pick).toBeVisible();
  await page.getByTestId('pick-repo-choose').click();

  await expect(pick).toHaveCount(0);
  await expect(page.getByText('Agent board')).toBeVisible();
  await expect(page.getByTestId('board-repo')).toHaveText(basename(repoDir));
  await page.getByTestId('open-connections').click({ trial: true });
  await app?.close();
  app = undefined;
});

test('the second launch goes straight to the board for the last repo', async () => {
  const page = await launch();
  await expect(page.getByText('Agent board')).toBeVisible();
  await expect(page.getByTestId('board-repo')).toHaveText(basename(repoDir));
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByTestId('open-connections').click({ trial: true });
});
