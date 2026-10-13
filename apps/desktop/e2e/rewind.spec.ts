import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { ADO_FIXTURE_PAT } from '@agent-lanes/ado-client/testing';
import type { RepoSettings, Result } from '@agent-lanes/contracts';
import { ADO_FIXTURE_PROJECT } from '@agent-lanes/contracts/testing';
import { FAKE_LOGIN, fakeClaudeEnv, writeFakeClaudeState, type FakeClaudeState } from './support/fake-claude-code';
import { startFakeAdoServer, type FakeAdoServer } from './support/fake-ado-server';
import { expandTurns } from './support/output-turns';

/**
 * Rewind to here (AL-265) in the real app: one of the user's messages offers Rewind, the modal
 * previews the files from a dry run, and confirming asks the SDK to restore them and writes a line
 * to the output. The fake `claude` answers the SDK's rewind request. Nothing leaves the machine.
 */

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

const AGENT: NonNullable<FakeClaudeState['lead']> = { turns: [{ steps: [{ text: 'Plan written.' }] }, { steps: [{ text: 'Filter added.' }] }] };

let root: string;
let ado: FakeAdoServer;
let app: ElectronApplication | undefined;
let page: Page;
let repo: string;
let logFile: string;

async function data<T>(channel: string, payload?: unknown): Promise<T> {
  const result = (await page.evaluate(
    ([name, body]) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name as string, body),
    [channel, payload] as const,
  )) as Result<T>;
  if (!result.ok) throw new Error(`${channel} failed: ${result.code} ${result.message}`);
  return result.data;
}

async function agentIdle(): Promise<void> {
  await expect.poll(async () => (await data<{ state: string }>('agent:getStatus', { ticketId: '71273' })).state, { timeout: 30_000 }).toBe('idle');
}

test.beforeAll(async () => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-rewind-')));
  ado = await startFakeAdoServer();
  repo = join(root, 'onsite-companion');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init', '--quiet', '--initial-branch=main');
  git('-c', 'user.name=Agent Lanes', '-c', 'user.email=e2e@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'Initial');
  const userDataDir = join(root, 'user-data');
  mkdirSync(userDataDir);
  const repoSettings: RepoSettings = { path: repo, name: 'onsite-companion', baseBranch: 'main', worktreeRoot: join(root, '.agent-lanes'), buildCommand: null, runCommand: null, maxConcurrentAgents: 3 };
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ version: 2, repos: [repoSettings], ui: { lastRepo: repo, lastSprint: null, collapsedLanes: ['done'], embedModeByTicket: {} } }));
  const stateFile = join(root, 'fake-claude-state.json');
  logFile = join(root, 'fake-claude.jsonl');
  writeFakeClaudeState(stateFile, { login: FAKE_LOGIN, log: logFile, lead: AGENT });
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir, CLAUDE_CONFIG_DIR: join(root, 'claude-config'), ...fakeClaudeEnv(stateFile) },
  });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));
  await expect(page.getByText('Agent board')).toBeVisible();
  await data('connections:save', { kind: 'ado', orgUrl: ado.orgUrl, pat: ADO_FIXTURE_PAT, defaultProject: ADO_FIXTURE_PROJECT });
  await data('connections:save', { kind: 'claude', mode: 'login' });
});

test.afterAll(async () => {
  await app?.close();
  app = undefined;
  await ado?.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('a user message offers Rewind to here: the modal previews the files, confirming restores them (AL-265)', async () => {
  await page.getByRole('button', { name: 'New agent ticket' }).click();
  const dialog = page.getByRole('dialog', { name: 'New agent ticket' });
  await dialog.getByRole('radio', { name: /^#71273 Cutover frmJobControl to Blazor/ }).click();
  await expect(dialog.getByRole('textbox', { name: 'What should the agent do?' })).not.toHaveValue('');
  await dialog.getByRole('button', { name: 'Launch agent' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await page.getByTestId('card-71273').click();
  const output = page.getByTestId('ticket-tab-output');
  await expect(output).toContainText('Plan written.', { timeout: 30_000 });
  await agentIdle();

  const box = page.getByPlaceholder('Message the agent — Enter sends, Shift+Enter for a new line');
  await box.fill('Add a filter');
  await box.press('Enter');
  await expect(output).toContainText('Filter added.', { timeout: 30_000 });
  await agentIdle();

  // The composer's message has Rewind to here; the launch job does too, but this one is newest. Finished turns are
  // collapsed to a summary row in Flight deck, so open them to reach the message.
  await expandTurns(page);
  const bubble = output.getByTestId('output-user').filter({ hasText: 'Add a filter' });
  await bubble.hover();
  await bubble.getByTestId('message-actions-rewind').click();
  const modal = page.getByTestId('rewind-modal');
  await expect(modal).toBeVisible();
  await expect(modal.getByTestId('rewind-summary')).toContainText('1 file goes back (+3 −1 lines undone).');
  await expect(modal).toContainText('src/JobGrid.razor');
  await modal.getByTestId('rewind-confirm').click();
  await expect(modal).toBeHidden({ timeout: 15_000 });
  await expect(output).toContainText('rewound the worktree to');
  await expect(output).toContainText('1 file restored (+3 −1)');

  await app!.close();
  app = undefined;
  const records = readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { rewinds: { userMessageId: string; dryRun: boolean }[] });
  const rewinds = records.flatMap((entry) => entry.rewinds);
  expect(rewinds.map((entry) => entry.dryRun)).toEqual([true, false]);
  expect(rewinds[0]!.userMessageId).toBe(rewinds[1]!.userMessageId);
});
