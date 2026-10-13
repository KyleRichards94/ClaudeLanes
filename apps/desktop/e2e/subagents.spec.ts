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

/**
 * Sub-agent transcripts (AL-261) in the real app: the fake `claude` spawns two sub-agents with the
 * SDK's task messages and their own tool calls; each one's rows nest under its Spawn row in the
 * output, its card shows its tokens, clicking the card opens that row, and Stop ends one sub-agent
 * while the lead agent carries on. Nothing leaves the machine.
 */

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

const AGENT: NonNullable<FakeClaudeState['lead']> = {
  turns: [
    {
      steps: [
        {
          spawn: {
            name: 'explore',
            description: 'Map the forms',
            tokens: 1_200,
            steps: [{ bash: { command: 'git log -1 --format=%s', output: 'Initial' } }, { text: 'Found 4 forms' }],
          },
        },
        {
          spawn: {
            name: 'writer',
            description: 'Write JobGrid.razor',
            tokens: 800,
            holdUntilStopped: true,
            steps: [{ bash: { command: 'dotnet build OnSite.sln', output: 'Build succeeded.' } }, { text: 'Writing JobGrid' }],
          },
        },
        { text: 'Both sub-agents are done.' },
      ],
    },
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

test.beforeAll(async () => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-subagents-')));
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

test('two sub-agents nest under their Spawn rows, their cards show tokens and open the row, and Stop ends one while the lead goes on (AL-261)', async () => {
  await page.getByRole('button', { name: 'New agent ticket' }).click();
  const dialog = page.getByRole('dialog', { name: 'New agent ticket' });
  await dialog.getByRole('radio', { name: /^#71273 Cutover frmJobControl to Blazor/ }).click();
  await expect(dialog.getByRole('textbox', { name: 'What should the agent do?' })).not.toHaveValue('');
  await dialog.getByRole('button', { name: 'Launch agent' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await page.getByTestId('card-71273').click();

  // explore finished; writer is held until it is stopped.
  const explore = page.getByRole('button', { name: 'explore, Done' });
  const writer = page.getByRole('button', { name: 'writer, Running' });
  await expect(explore).toBeVisible({ timeout: 30_000 });
  await expect(writer).toBeVisible();
  await expect(page.getByTestId('sub-agents-counts')).toHaveText('1 running · 1 done');
  await expect(explore.locator('[data-testid$="-tokens"]')).toHaveText('1k tokens');
  await expect(writer.locator('[data-testid$="-tokens"]')).toHaveText('800 tokens');

  // Each Spawn row is closed, with its sub-agent's latest line; its own rows show once it is opened.
  const output = page.getByTestId('ticket-tab-output');
  const latest = output.getByTestId('output-spawn-latest');
  await expect(latest).toHaveCount(2);
  await expect(latest.first()).toHaveText('explore · Found 4 forms');
  await expect(latest.nth(1)).toHaveText('writer · Writing JobGrid');
  await expect(output.locator('[data-testid^="output-subagent-"]')).toHaveCount(0);

  await explore.click();
  const lane = output.locator('[data-testid^="output-subagent-"]');
  await expect(lane).toHaveCount(1);
  await expect(lane).toContainText('git log -1 --format=%s');
  await expect(lane).toContainText('Found 4 forms');
  await expect(output.getByTestId('output-spawn-latest')).toHaveCount(1);

  // Stop the writer: its task ends as stopped, and the lead agent finishes its turn.
  // Stop sits beside the row (a button inside a button is not valid), under the Agents card.
  await page.locator('[data-testid^="sub-agent-"][data-testid$="-stop"]').click();
  await expect(page.getByRole('button', { name: 'writer, Failed' })).toBeVisible({ timeout: 15_000 });
  await expect(output).toContainText('Both sub-agents are done.', { timeout: 30_000 });
  await expect.poll(async () => (await data<{ state: string }>('agent:getStatus', { ticketId: '71273' })).state, { timeout: 30_000 }).toBe('idle');
  await expect(page.getByTestId('sub-agents-counts')).toHaveText('1 done · 1 failed');

  // The fake records how each sub-agent ended once its stdin closes.
  await app!.close();
  app = undefined;
  const records = readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { tools: { tool: string; name?: string; status?: string }[] });
  const agents = records.flatMap((record) => record.tools.filter((tool) => tool.tool === 'Agent'));
  expect(agents).toEqual([
    { tool: 'Agent', name: 'explore', status: 'completed' },
    { tool: 'Agent', name: 'writer', status: 'stopped' },
  ]);
});
