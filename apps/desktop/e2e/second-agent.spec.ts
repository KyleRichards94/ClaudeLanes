import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { ADO_FIXTURE_PAT } from '@agent-lanes/ado-client/testing';
import type { RepoSettings, Result, TicketRecord } from '@agent-lanes/contracts';
import { ADO_FIXTURE_PROJECT } from '@agent-lanes/contracts/testing';
import { FAKE_LOGIN, fakeClaudeEnv, writeFakeClaudeState, type FakeClaudeState } from './support/fake-claude-code';
import { startFakeAdoServer, type FakeAdoServer } from './support/fake-ado-server';

/**
 * Second agent on a ticket (AL-266) in the real app: a read-only reviewer runs beside the lead in the
 * same worktree with its own output and composer; stopping it leaves the lead running; a helper gets
 * its own sub-branch, which shows in Sub-branches; the board shows neither. The fake `claude` answers
 * each agent's first turn; its log says where each process ran and which tools it was denied.
 */

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

interface FakeProcess {
  argv: string[];
  cwd: string;
  prompts: string[];
}

const AGENT: NonNullable<FakeClaudeState['lead']> = {
  // Each `claude` process starts with its own turn list: the companions' briefs are matched before the plain job.
  turns: [
    { match: 'You are the reviewer', steps: [{ text: 'Reviewing.' }] },
    { match: 'You are the helper', steps: [{ text: 'Helping.' }] },
    { match: 'What to do', steps: [{ text: 'Started from the job.' }] },
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

async function record(ticketId: string): Promise<TicketRecord> {
  const found = await data<{ record: TicketRecord | null }>('tickets:get', { ticketId });
  if (!found.record) throw new Error(`no record ${ticketId}`);
  return found.record;
}

async function state(ticketId: string): Promise<string> {
  return (await data<{ state: string }>('agent:getStatus', { ticketId })).state;
}

test.beforeAll(async () => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-second-agent-')));
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

test.describe.configure({ mode: 'serial' });

test('a reviewer runs beside the lead in the same worktree with its own output; stopping it leaves the lead (AL-266)', async () => {
  await page.getByRole('button', { name: 'New agent ticket' }).click();
  const dialog = page.getByRole('dialog', { name: 'New agent ticket' });
  await dialog.getByRole('radio', { name: /^#71273 Cutover frmJobControl to Blazor/ }).click();
  await expect(dialog.getByRole('textbox', { name: 'What should the agent do?' })).not.toHaveValue('');
  await dialog.getByRole('button', { name: 'Launch agent' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await page.getByTestId('card-71273').click();
  const output = page.getByTestId('ticket-tab-output');
  await expect(output).toContainText('Started from the job.', { timeout: 30_000 });
  await expect.poll(() => state('71273'), { timeout: 30_000 }).toBe('idle');
  await expect(page.getByTestId('agent-switcher')).toHaveCount(0);

  await page.getByTestId('add-agent-open').click();
  const modal = page.getByTestId('add-agent-modal');
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('radio', { name: 'Reviewer' })).toHaveAttribute('aria-checked', 'true');
  await modal.getByTestId('add-agent-name').fill('Eyes');
  await modal.getByTestId('add-agent-confirm').click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  // The page switches to the reviewer: its own output, beside the lead's; the Agents card lists it.
  const switcher = page.getByTestId('agent-switcher');
  await expect(switcher).toBeVisible({ timeout: 15_000 });
  await expect(switcher.getByRole('radio', { name: 'Eyes · Reviewer' })).toHaveAttribute('aria-checked', 'true');
  await expect(output).toContainText('Reviewing.', { timeout: 30_000 });
  await expect(output).not.toContainText('Started from the job.');
  const reviewer = await record('71273-reviewer-eyes');
  const lead = await record('71273');
  expect(reviewer.companion).toEqual({ of: '71273', role: 'reviewer', name: 'Eyes' });
  expect(reviewer.worktreePath.toLowerCase()).toBe(lead.worktreePath.toLowerCase());
  expect(reviewer.branch).toBe(lead.branch);
  const row = page.getByTestId('companion-71273-reviewer-eyes');
  await expect(row).toContainText('Eyes · Reviewer');
  await expect(row).toContainText('Read-only');
  await expect.poll(() => state('71273-reviewer-eyes'), { timeout: 30_000 }).toBe('idle');

  // Stop the reviewer: it ends, the lead stays idle, Remove replaces Stop.
  await row.getByTestId('companion-71273-reviewer-eyes-stop').click();
  await expect.poll(() => state('71273-reviewer-eyes'), { timeout: 30_000 }).toBe('stopped');
  expect(await state('71273')).toBe('idle');
  await expect(row.getByTestId('companion-71273-reviewer-eyes-remove')).toBeVisible();

  // Back to the lead's output.
  await switcher.getByRole('radio', { name: 'Lead' }).click();
  await expect(output).toContainText('Started from the job.');
  await expect(output).not.toContainText('Reviewing.');
});

test('a helper works on its own sub-branch, shown in Sub-branches; the board shows neither agent (AL-266)', async () => {
  await page.getByTestId('agent-menu').click();
  await page.getByRole('menuitem', { name: 'Add agent…' }).click();
  const modal = page.getByTestId('add-agent-modal');
  await modal.getByRole('radio', { name: 'Helper' }).click();
  await modal.getByTestId('add-agent-name').fill('Docs');
  await modal.getByTestId('add-agent-prompt').fill('Write the release notes.');
  await modal.getByTestId('add-agent-confirm').click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  const output = page.getByTestId('ticket-tab-output');
  await expect(output).toContainText('Helping.', { timeout: 30_000 });
  const helper = await record('71273-helper-docs');
  expect(helper.companion).toEqual({ of: '71273', role: 'helper', name: 'Docs' });
  expect(helper.branch).toBe('sub/71273-docs');
  const lead = await record('71273');
  expect(lead.subBranches.map((sub) => sub.branch)).toEqual(['sub/71273-docs']);
  await expect(page.getByTestId('companion-71273-helper-docs')).toContainText('sub/71273-docs');
  // branches:status runs real git per sub-branch: give it time on a busy machine.
  await expect(page.getByTestId('sub-branch-sub/71273-docs')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => state('71273-helper-docs'), { timeout: 30_000 }).toBe('idle');

  await page.getByRole('button', { name: '← Board' }).click();
  await expect(page.getByTestId('card-71273')).toBeVisible();
  await expect(page.getByTestId('card-71273-helper-docs')).toHaveCount(0);
  await expect(page.getByTestId('card-71273-reviewer-eyes')).toHaveCount(0);

  // The fake's log: the reviewer ran in the lead's worktree without its write tools; the helper in its own.
  await app!.close();
  app = undefined;
  const processes = readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as FakeProcess)
    .filter((entry) => entry.prompts.length > 0);
  expect(processes).toHaveLength(3);
  // Logged as each process exits (the stopped reviewer first), so match them by their first turn.
  const runFor = (text: string) => processes.find((entry) => entry.prompts[0]?.includes(text));
  // Every first turn opens with the work item; only the lead's has no companion brief.
  const leadRun = processes.find((entry) => !entry.prompts[0]?.includes('You are the '));
  const reviewerRun = runFor('You are the reviewer "Eyes"');
  const helperRun = runFor('You are the helper "Docs"');
  if (!leadRun || !reviewerRun || !helperRun) throw new Error(`unexpected processes: ${processes.map((entry) => entry.prompts[0]?.slice(0, 40)).join(' | ')}`);
  expect(reviewerRun.cwd.toLowerCase()).toBe(leadRun.cwd.toLowerCase());
  expect(reviewerRun.argv.join(' ')).toMatch(/--disallowedTools\s+\S*Edit/);
  expect(leadRun.argv.join(' ')).not.toContain('--disallowedTools');
  expect(helperRun.cwd.toLowerCase()).toBe(join(root, '.agent-lanes', '71273--docs').toLowerCase());
  expect(helperRun.argv.join(' ')).not.toContain('--disallowedTools');
});
