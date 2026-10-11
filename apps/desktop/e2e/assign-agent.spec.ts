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
 * Assign new agent (AL-263) in the real app: a running agent is replaced by a Sonnet one that starts
 * from a hand-over brief; an ended one is replaced from the session pill with Start fresh, which
 * sends the original job again. Both run in the same worktree; the earlier output stays above the
 * divider; the record keeps the past sessions. Nothing leaves the machine.
 */

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

const AGENT: NonNullable<FakeClaudeState['lead']> = {
  // Each `claude` process starts with its own turn list, so the brief must be matched before the job.
  turns: [
    { match: 'Hand-over brief', steps: [{ text: 'Taking over.' }] },
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

async function record(): Promise<TicketRecord> {
  const found = await data<{ record: TicketRecord | null }>('tickets:get', { ticketId: '71273' });
  if (!found.record) throw new Error('no record');
  return found.record;
}

async function agentIdle(): Promise<void> {
  await expect.poll(async () => (await data<{ state: string }>('agent:getStatus', { ticketId: '71273' })).state, { timeout: 30_000 }).toBe('idle');
}

test.beforeAll(async () => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-assign-')));
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

test('hands a running ticket over to a new Sonnet agent with a brief, keeping the earlier output (AL-263)', async () => {
  await page.getByRole('button', { name: 'New agent ticket' }).click();
  const dialog = page.getByRole('dialog', { name: 'New agent ticket' });
  await dialog.getByRole('radio', { name: /^#71273 Cutover frmJobControl to Blazor/ }).click();
  await expect(dialog.getByRole('textbox', { name: 'What should the agent do?' })).not.toHaveValue('');
  await dialog.getByRole('button', { name: 'Launch agent' }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  await page.getByTestId('card-71273').click();
  const output = page.getByTestId('ticket-tab-output');
  await expect(output).toContainText('Started from the job.', { timeout: 30_000 });
  await agentIdle();
  const first = await record();
  expect(first.sessionId).not.toBeNull();

  await page.getByTestId('agent-menu').click();
  await page.getByRole('menuitem', { name: 'Assign new agent…' }).click();
  const modal = page.getByTestId('assign-agent-modal');
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('radio', { name: 'Hand over' })).toHaveAttribute('aria-checked', 'true');
  await modal.getByRole('radio', { name: 'Sonnet' }).click();
  await modal.getByTestId('assign-agent-confirm').click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  // The divider and the hand-over bubble follow the earlier output; the new agent answers the brief.
  await expect(output).toContainText('New agent · Sonnet · XHigh · handed over', { timeout: 30_000 });
  await expect(output).toContainText('Handed over');
  await expect(output).toContainText('Taking over.', { timeout: 30_000 });
  await expect(output).toContainText('Started from the job.');
  await agentIdle();
  const second = await record();
  expect(second.model).toBe('sonnet');
  expect(second.sessionId).not.toBe(first.sessionId);
  expect(second.pastSessions?.map((past) => past.sessionId)).toEqual([first.sessionId]);
  expect(second.job).toContain('frmJobControl');
});

test('an ended session offers Assign new agent on its pill; Start fresh sends the original job (AL-263)', async () => {
  await page.getByTestId('agent-menu').click();
  await page.getByRole('menuitem', { name: 'End session' }).click();
  await page.getByTestId('agent-menu-confirm-end').click();
  const assign = page.getByTestId('session-assign');
  await expect(assign).toBeVisible({ timeout: 15_000 });
  await assign.click();
  const modal = page.getByTestId('assign-agent-modal');
  await modal.getByRole('radio', { name: 'Start fresh' }).click();
  await modal.getByTestId('assign-agent-confirm').click();
  await expect(modal).toBeHidden({ timeout: 30_000 });

  const output = page.getByTestId('ticket-tab-output');
  await expect(output).toContainText('started fresh', { timeout: 30_000 });
  await expect(output.getByText('Started from the job.')).toHaveCount(2, { timeout: 30_000 });
  await agentIdle();
  expect((await record()).pastSessions).toHaveLength(2);

  // The fake's log: the second start got the brief, the third the original job without it.
  await app!.close();
  app = undefined;
  const records = readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as { prompts: string[] })
    // Skills discovery starts a process with no prompt; the three sessions each got one.
    .filter((entry) => entry.prompts.length > 0);
  expect(records).toHaveLength(3);
  expect(records[1]!.prompts[0]).toContain('Hand-over brief: you are taking over');
  expect(records[2]!.prompts[0]).toContain('What to do');
  expect(records[2]!.prompts[0]).not.toContain('Hand-over brief');
});
