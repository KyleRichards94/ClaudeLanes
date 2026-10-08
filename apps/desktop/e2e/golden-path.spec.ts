import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { ADO_FIXTURE_PAT } from '@agent-lanes/ado-client/testing';
import type { Result, TicketRecord } from '@agent-lanes/contracts';
import { ADO_FIXTURE_IDENTITY, ADO_FIXTURE_PROJECT } from '@agent-lanes/contracts/testing';
import { fakeClaudeEnv, writeFakeClaudeState, type FakeClaudeState } from './support/fake-claude-code';
import { startFakeAdoServer, type FakeAdoServer } from './support/fake-ado-server';
import { startFakeClaudeSite } from './support/fake-claude-site';

/**
 * AL-222, the golden path in the real app on a fresh profile: first run → connect Azure DevOps and
 * Claude → pick a temporary repo → launch a ticket from the sprint → approve the plan on the stage
 * stepper → ship a design while the agent is Implementing (R11) → approve the PR gate on the board
 * card → merge the worktree into main, which is pushed to the repo's origin.
 *
 * Every outside service is a fake swapped in through main's test hooks (src/main/test-hooks.ts, left
 * out of `pnpm package` builds): Azure DevOps is the shared MSW organisation on 127.0.0.1, Claude
 * Code is the fake `claude` binary scripted as the ticket's agent (it calls `set_stage` and the
 * design-spec tools through the Agent SDK and commits in its worktree), and claude.ai's Design canvas
 * is a local site. Nothing leaves the machine. The whole path must finish inside CI's five minutes.
 */

const GOLDEN_PATH_BUDGET_MS = 5 * 60_000;
const CANVAS = 'https://claude.ai/design/p/golden-canvas';

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

let root: string;
let repo: string;
let origin: string;
let ado: FakeAdoServer;
let site: Awaited<ReturnType<typeof startFakeClaudeSite>>;
let app: ElectronApplication | undefined;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=Agent Lanes Test', '-c', 'user.email=test@agent-lanes.invalid', '-c', 'commit.gpgsign=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

async function data<T>(page: Page, channel: string, payload?: unknown): Promise<T> {
  const result = (await page.evaluate(
    ([name, body]) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name as string, body),
    [channel, payload] as const,
  )) as Result<T>;
  if (!result.ok) throw new Error(`${channel} failed: ${result.code} ${result.message}`);
  return result.data;
}

async function record(page: Page): Promise<TicketRecord> {
  const { record: found } = await data<{ record: TicketRecord | null }>(page, 'tickets:get', { ticketId: '71273' });
  if (!found) throw new Error('Ticket 71273 has no record.');
  return found;
}

/** The ticket's agent, scripted: plan, wait for approval, build, take the design, review, QA, ask for the PR. */
const AGENT: FakeClaudeState['lead'] = {
  turns: [
    {
      steps: [
        { tool: 'report_activity', input: { text: 'Planning the cutover', progress: 60 } },
        { tool: 'set_stage', input: { stage: 'implementing', summary: 'Plan ready: JobGrid.razor replaces frmJobControl' } },
        { tool: 'report_activity', input: { text: 'Building JobGrid.razor', progress: 20 } },
        { commit: { file: 'src/JobGrid.razor', content: '<h1>Jobs</h1>\n', message: 'Add JobGrid.razor' } },
        { text: 'Plan approved. JobGrid.razor is in; carrying on with the grid.' },
      ],
    },
    {
      match: 'Design v1 approved',
      steps: [
        { tool: 'get_design_spec', input: {} },
        { tool: 'ack_design_spec', input: { version: 1, note: 'Built JobGrid.razor from JobControl · desktop' } },
        { commit: { file: 'src/JobGrid.razor', content: '<h1 class="title">Jobs</h1>\n<JobFilter />\n', message: 'Follow Design v1 in JobGrid.razor' } },
        { tool: 'set_stage', input: { stage: 'code-review', summary: 'Grid follows Design v1' } },
        { tool: 'set_stage', input: { stage: 'qa', summary: 'Review clean' } },
        { tool: 'set_stage', input: { stage: 'create-pr', summary: 'QA passed' } },
        { text: 'Design v1 is in, and review and QA passed.' },
      ],
    },
  ],
};

test.beforeAll(async () => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-golden-')));
  writeFileSync(join(root, 'gitconfig'), '');
  origin = join(root, 'origin.git');
  repo = join(root, 'onsite-companion');
  mkdirSync(repo);
  git(root, 'init', '--quiet', '--bare', '--initial-branch=main', origin);
  git(repo, 'init', '--quiet', '--initial-branch=main');
  writeFileSync(join(repo, 'README.md'), '# OnSite Companion\n');
  git(repo, 'add', '--all');
  git(repo, 'commit', '--quiet', '-m', 'Initial commit');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '--quiet', '--set-upstream', 'origin', 'main');

  ado = await startFakeAdoServer();
  site = await startFakeClaudeSite();
  const stateFile = join(root, 'fake-claude-state.json');
  writeFakeClaudeState(stateFile, {
    login: { email: 'kyle@example.test', organization: 'Companion Systems', subscriptionType: 'team' },
    log: join(root, 'fake-claude.jsonl'),
    design: { artboards: [{ id: 'job-control.html', name: 'JobControl · desktop', width: 1440, height: 900 }] },
    lead: AGENT,
  });

  // A fresh profile, and first run is not skipped (playwright.config.ts skips it for every other spec).
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && key !== 'AGENT_LANES_SKIP_FIRST_RUN') env[key] = value;
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: {
      ...env,
      AGENT_LANES_USER_DATA_DIR: join(root, 'profile'),
      AGENT_LANES_DESIGN_TEST_ORIGIN: site.origin,
      CLAUDE_CONFIG_DIR: join(root, 'claude-config'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: join(root, 'gitconfig'),
      ...fakeClaudeEnv(stateFile),
    },
  });
  await app.evaluate(({ dialog, shell }, folder) => {
    // The folder picker returns the temporary repo; links meant for the OS browser go nowhere.
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog;
    shell.openExternal = async () => undefined;
  }, repo);
});

test.afterAll(async () => {
  await app?.close();
  await ado?.close();
  await site?.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('first run to merged: connect, pick a repo, launch, approve the plan, ship a design while Implementing, merge (AL-222)', async () => {
  test.setTimeout(GOLDEN_PATH_BUDGET_MS);
  const started = Date.now();
  const page = await app!.firstWindow();
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));

  await test.step('first run: connect Azure DevOps and Claude, then pick the repo', async () => {
    const connections = page.getByRole('dialog', { name: 'Connections' });
    await expect(connections).toBeVisible();
    await page.getByTestId('ado-org-url').fill(ado.orgUrl);
    await page.getByTestId('ado-pat').fill(ADO_FIXTURE_PAT);
    await page.getByTestId('ado-test-connection').click();
    await expect(page.getByTestId('ado-test-outcome')).toContainText(`signed in as ${ADO_FIXTURE_IDENTITY}`);
    await page.getByTestId('ado-default-project').fill(ADO_FIXTURE_PROJECT);
    await page.getByTestId('connections-save').click();
    await expect(page.getByTestId('connection-ado:contoso')).toBeVisible();

    await page.getByRole('tab', { name: /^Claude/ }).click();
    await expect(page.getByTestId('claude-detection')).toContainText('kyle@example.test (Companion Systems)');
    await page.getByTestId('claude-test-connection').click();
    await expect(page.getByTestId('claude-test-outcome')).toContainText('Connection works');
    await page.getByTestId('connections-save').click();

    const pick = page.getByRole('dialog', { name: 'Pick a repo' });
    await expect(pick).toBeVisible();
    await page.getByTestId('pick-repo-choose').click();
    // Adding the repo reads its branches and origin with real git.
    await expect(pick).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByText('Agent board')).toBeVisible();
    await expect(page.getByTestId('board-repo')).toHaveText(basename(repo));
  });

  await test.step('create the ticket: launch #71273 from the sprint', async () => {
    await page.getByRole('button', { name: 'New agent ticket' }).click();
    const dialog = page.getByRole('dialog', { name: 'New agent ticket' });
    await dialog.getByRole('radio', { name: /^#71273 Cutover frmJobControl to Blazor/ }).click();
    await expect(dialog.getByRole('textbox', { name: 'What should the agent do?' })).not.toHaveValue('');
    await dialog.getByRole('button', { name: 'Launch agent' }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByTestId('lane-planning').getByTestId('card-71273')).toBeVisible();
  });

  await test.step('approve the plan on the stage stepper', async () => {
    // The agent finished its plan and asked to move on: the Planning gate waits, on the card and the stepper.
    await expect(page.getByTestId('gate-card-71273')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('card-71273').click();
    const approve = page.getByTestId('gate-stepper-71273-approve');
    await expect(approve).toBeVisible();
    await approve.click();
    await expect(page.getByTestId('gate-stepper-71273')).toHaveCount(0);

    await expect.poll(async () => (await record(page)).stage, { timeout: 30_000 }).toBe('implementing');
    // The agent committed its first change in the ticket's worktree and its turn ended.
    await expect.poll(async () => git((await record(page)).worktreePath, 'log', '-1', '--format=%s'), { timeout: 30_000 }).toBe('Add JobGrid.razor');
    await expect.poll(async () => (await data<{ state: string }>(page, 'agent:getStatus', { ticketId: '71273' })).state, { timeout: 30_000 }).toBe('idle');
  });

  await test.step('ship a design while the agent is Implementing (R11)', async () => {
    await page.getByRole('tab', { name: 'Claude Design' }).click();
    await expect(page.getByTestId('design-stage-pill')).toHaveText(/^Implementing/);
    await page.getByTestId('link-canvas-url').fill(CANVAS);
    await page.getByRole('button', { name: 'Link canvas' }).click();
    await expect(page.getByTestId('design-canvas-slot')).toBeVisible();

    const artboard = page.getByRole('checkbox', { name: 'JobControl · desktop, 1440×900' });
    await expect(artboard).toBeVisible({ timeout: 30_000 });
    await artboard.click();
    await page.getByTestId('ship-note').fill('Keep the title bold');
    await page.getByRole('button', { name: 'Send 1 artboard to agent as spec' }).click();
    // The session is live, so the spec goes to the agent at once.
    await expect(page.getByTestId('ship-result')).toHaveText('Design v1 approved and sent to the agent.');

    // The agent read the spec and acknowledged it while Implementing.
    await expect(page.getByTestId('design-spec-v1-status')).toHaveText(/^Used · /, { timeout: 30_000 });
  });

  await test.step('the agent reviews and tests, and the PR gate is approved on the board card', async () => {
    await page.evaluate(() => {
      (globalThis as unknown as { location: { hash: string } }).location.hash = '#/board';
    });
    const gate = page.getByTestId('gate-card-71273');
    await expect(gate).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await record(page)).stage).toBe('qa');
    await page.getByTestId('gate-card-71273-approve').click();
    await expect.poll(async () => (await record(page)).stage, { timeout: 30_000 }).toBe('create-pr');
    await expect.poll(async () => (await data<{ state: string }>(page, 'agent:getStatus', { ticketId: '71273' })).state, { timeout: 30_000 }).toBe('idle');
  });

  await test.step('merge the worktree into main', async () => {
    await page.getByTestId('card-71273').click();
    const merge = page.getByTestId('merge-to-main');
    await expect(merge).toBeEnabled({ timeout: 30_000 });
    await merge.click();
    const modal = page.getByTestId('merge-to-main-modal');
    await expect(modal.getByTestId('merge-to-main-summary')).toContainText('2 commits on 71273-');
    // QA passed, so there is no warning and no "Merge anyway".
    await expect(modal.getByTestId('merge-to-main-qa-warning')).toHaveCount(0);
    await modal.getByRole('button', { name: 'Merge into main' }).click();
    await expect(page.getByText(/^Merged into main · /)).toBeVisible({ timeout: 60_000 });

    await expect.poll(async () => (await record(page)).stage, { timeout: 30_000 }).toBe('done');
    // main has the agent's work and was pushed to origin.
    expect(git(origin, 'log', 'main', '--format=%s')).toMatch(/^Merge branch '71273-[^']+' into main\n/);
    expect(git(origin, 'show', 'main:src/JobGrid.razor')).toContain('<JobFilter />');
  });

  // Azure DevOps heard about the work: each lane change was written back to the work item.
  expect((ado.org.state.comments.get(71273) ?? []).length).toBeGreaterThan(0);
  expect(Date.now() - started).toBeLessThan(GOLDEN_PATH_BUDGET_MS);
});
