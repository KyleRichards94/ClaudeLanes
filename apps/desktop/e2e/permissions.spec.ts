import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { ADO_FIXTURE_PAT } from '@agent-lanes/ado-client/testing';
import type { RepoSettings, Result, Settings } from '@agent-lanes/contracts';
import { ADO_FIXTURE_PROJECT } from '@agent-lanes/contracts/testing';
import { FAKE_LOGIN, fakeClaudeEnv, writeFakeClaudeState, type FakeClaudeState } from './support/fake-claude-code';
import { startFakeAdoServer, type FakeAdoServer } from './support/fake-ado-server';

/**
 * Permission prompts at the waiting row (AL-260) in the real app: the fake `claude` asks
 * `canUseTool` the way the CLI does, the prompt renders inside the output at the tool row that
 * waits, Always allow saves a rule on the repo that answers the next matching call without a
 * prompt, and Deny with a reason reaches the agent as the denial message. Nothing leaves the machine.
 */

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

const AGENT: NonNullable<FakeClaudeState['lead']> = {
  turns: [
    { steps: [{ ask: { tool: 'Bash', input: { command: 'dotnet publish OnSite.sln -c Release', description: 'Publish the app' } } }, { text: 'Published.' }] },
    { match: 'again', steps: [{ ask: { tool: 'Bash', input: { command: 'dotnet publish OnSite.sln -c Debug' } } }, { text: 'Published again.' }] },
    { match: 'fetch', steps: [{ ask: { tool: 'Bash', input: { command: 'curl https://example.test/spec.json' } } }, { text: 'Done with the fetch.' }] },
  ],
};

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
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-permissions-')));
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

test.describe.configure({ mode: 'serial' });

test('the prompt sits at the waiting tool row, and Always allow saves a rule the next call passes on (AL-260)', async () => {
  await page.getByRole('button', { name: 'New agent ticket' }).click();
  const dialog = page.getByRole('dialog', { name: 'New agent ticket' });
  await dialog.getByRole('radio', { name: /^#71273 Cutover frmJobControl to Blazor/ }).click();
  await expect(dialog.getByRole('textbox', { name: 'What should the agent do?' })).not.toHaveValue('');
  await dialog.getByRole('button', { name: 'Launch agent' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // The board card has its own prompt under it (AL-109).
  await expect(page.getByTestId('permission-71273')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('card-71273').click();

  // In the drill-in the prompt is at the tool row that waits, with the whole input; nothing sits above the stream.
  const row = page.getByTestId('output-tool-waiting');
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row).toContainText('Needs you');
  await expect(row).toContainText('dotnet publish OnSite.sln -c Release');
  const inline = page.getByTestId('permission-71273-inline');
  await expect(inline).toBeVisible();
  await expect(inline.getByTestId('permission-71273-inline-detail')).toContainText('# Publish the app');
  await expect(page.getByTestId('ticket-stepper-band').getByTestId('permission-71273')).toHaveCount(0);
  const rowBox = await row.boundingBox();
  const promptBox = await inline.boundingBox();
  expect(promptBox!.y).toBeGreaterThan(rowBox!.y);

  await inline.getByTestId('permission-71273-inline-allow-always').click();
  await expect(inline).toHaveCount(0);
  await expect(page.getByTestId('output-tool-waiting')).toHaveCount(0);
  await agentIdle();
  // The rule is on the repo in Settings.
  await expect.poll(async () => (await data<Settings>('settings:get')).repos[0]?.permissionRules).toEqual(['Bash(dotnet publish:*)']);

  // The next publish never asks.
  const box = page.getByPlaceholder('Message the agent — Enter sends, Shift+Enter for a new line');
  await box.fill('Publish again');
  await box.press('Enter');
  await expect(page.getByTestId('ticket-tab-output')).toContainText("Allowed Bash by the repo's rule", { timeout: 30_000 });
  await agentIdle();
  await expect(page.getByTestId('permission-71273-inline')).toHaveCount(0);
});

test('Deny with a reason reaches the agent as the denial message (AL-260)', async () => {
  const box = page.getByPlaceholder('Message the agent — Enter sends, Shift+Enter for a new line');
  await box.fill('Now fetch the spec');
  await box.press('Enter');
  const inline = page.getByTestId('permission-71273-inline');
  await expect(inline).toBeVisible({ timeout: 30_000 });
  await expect(inline).toContainText('curl https://example.test/spec.json');

  await inline.getByTestId('permission-71273-inline-deny').click();
  await inline.getByTestId('permission-71273-inline-deny-reason').fill('Use the copy in docs/spec.json');
  await inline.getByTestId('permission-71273-inline-deny-send').click();
  await expect(inline).toHaveCount(0);
  await expect(page.getByTestId('ticket-tab-output')).toContainText('denied Bash · curl https://example.test/spec.json · Use the copy in docs/spec.json');
  await agentIdle();

  // The fake writes its log when its stdin closes: what each ask was answered with.
  await app!.close();
  app = undefined;
  const records = readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { tools: { tool: string; ask?: { behavior: string | null; message?: string } }[] });
  const asks = records.flatMap((record) => record.tools.filter((tool) => tool.ask));
  expect(asks.map((tool) => tool.ask!.behavior)).toEqual(['allow', 'allow', 'deny']);
  expect(asks[2]!.ask!.message).toContain('The user said: Use the copy in docs/spec.json');
});
