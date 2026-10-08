import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { ADO_FIXTURE_PAT } from '@agent-lanes/ado-client/testing';
import type { RepoSettings, Result } from '@agent-lanes/contracts';
import { ADO_FIXTURE_PROJECT } from '@agent-lanes/contracts/testing';
import { FAKE_LOGIN, fakeClaudeEnv, writeFakeClaudeState } from './support/fake-claude-code';
import { startFakeAdoServer, type FakeAdoServer } from './support/fake-ado-server';

/**
 * Launch (AL-165) in the real app: pick a Sprint 42 item from the fake Azure DevOps organisation,
 * press Launch, and the agent's card is running in Planning with its own worktree and branch. The
 * `claude` binary is the e2e stand-in, so no request leaves the machine.
 */

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

let root: string;
let ado: FakeAdoServer;
let app: ElectronApplication | undefined;
let page: Page;
let repo: string;

async function data<T>(channel: string, payload?: unknown): Promise<T> {
  const result = (await page.evaluate(
    ([name, body]) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name as string, body),
    [channel, payload] as const,
  )) as Result<T>;
  if (!result.ok) throw new Error(`${channel} failed: ${result.code} ${result.message}`);
  return result.data;
}

test.beforeEach(async () => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-launch-')));
  ado = await startFakeAdoServer();
  repo = join(root, 'onsite-companion');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init', '--quiet', '--initial-branch=main');
  git('-c', 'user.name=Agent Lanes', '-c', 'user.email=e2e@example.invalid', 'commit', '--quiet', '--allow-empty', '-m', 'Initial');
  const userDataDir = join(root, 'user-data');
  mkdirSync(userDataDir);
  const repoSettings: RepoSettings = {
    path: repo,
    name: 'onsite-companion',
    baseBranch: 'main',
    worktreeRoot: join(root, '.agent-lanes'),
    buildCommand: null,
    runCommand: null,
    maxConcurrentAgents: 3,
  };
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ version: 2, repos: [repoSettings], ui: { lastRepo: repo, lastSprint: null, collapsedLanes: ['done'], embedModeByTicket: {} } }));
  const stateFile = join(root, 'fake-claude-state.json');
  writeFakeClaudeState(stateFile, { login: FAKE_LOGIN, log: join(root, 'fake-claude-starts.jsonl') });

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

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  await ado?.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('a sprint item becomes a running Planning card in its own worktree, in well under a minute (AL-165)', async () => {
  const started = Date.now();
  await page.getByRole('button', { name: 'New agent ticket' }).click();
  const dialog = page.getByRole('dialog', { name: 'New agent ticket' });
  await dialog.getByRole('radio', { name: /^#71273 Cutover frmJobControl to Blazor/ }).click();
  // The job is prefilled from the work item (AL-162); Launch takes it as it is.
  await expect(dialog.getByRole('textbox', { name: 'What should the agent do?' })).not.toHaveValue('');
  await dialog.getByRole('button', { name: 'Launch agent' }).click();

  await expect(dialog).toBeHidden({ timeout: 30_000 });
  const card = page.getByTestId('lane-planning').getByTestId('card-71273');
  await expect(card).toBeVisible();
  await expect(page.getByTestId('card-71273-launched')).toBeVisible();
  // Everything the user did, from opening the modal to the card running, took well under a minute.
  expect(Date.now() - started).toBeLessThan(60_000);
  await page.screenshot({ path: test.info().outputPath('launched.png') });

  // Its worktree and branch exist, and the agent's first turn reached the session.
  expect(existsSync(join(root, '.agent-lanes', '71273'))).toBe(true);
  const branches = execFileSync('git', ['branch', '--list', '71273-*'], { cwd: repo, encoding: 'utf8' });
  expect(branches).toContain('71273-cutover-frmjobcontrol-to');
  await expect.poll(async () => (await data<{ state: string }>('agent:getStatus', { ticketId: '71273' })).state).toMatch(/running|idle/);
  const record = await data<{ record: { stage: string; ado: { workItemId: number } | null } | null }>('tickets:get', { ticketId: '71273' });
  expect(record.record).toMatchObject({ stage: 'planning', ado: { workItemId: 71273 } });
});

test('a launch the session refuses leaves no worktree, branch or card behind', async () => {
  // Claude is no longer connected: the session can't start, so the launch is rolled back.
  await data('connections:remove', { id: 'claude' });
  await page.getByRole('button', { name: 'New agent ticket' }).click();
  const dialog = page.getByRole('dialog', { name: 'New agent ticket' });
  await dialog.getByRole('radio', { name: 'No ticket' }).click();
  await dialog.getByRole('textbox', { name: 'What should the agent do?' }).fill('Fix the supplier portal login');
  await dialog.getByRole('button', { name: 'Launch agent' }).click();

  await expect(dialog.getByText('Connect Claude in Connections before starting an agent.')).toBeVisible({ timeout: 30_000 });
  await expect(dialog).toBeVisible();
  const worktreeRoot = join(root, '.agent-lanes');
  expect(existsSync(worktreeRoot) ? readdirSync(worktreeRoot) : []).toEqual([]);
  expect(execFileSync('git', ['branch', '--list', 'nt-*'], { cwd: repo, encoding: 'utf8' }).trim()).toBe('');
  expect(await data<unknown[]>('tickets:list')).toEqual([]);
});
