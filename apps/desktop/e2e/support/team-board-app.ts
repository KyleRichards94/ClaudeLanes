import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import type { FakeWorkItem } from '@agent-lanes/ado-client/testing';
import type { RepoSettings, Result } from '@agent-lanes/contracts';
import { ADO_FIXTURE_PROJECT } from '@agent-lanes/contracts/testing';
import { FAKE_LOGIN, fakeClaudeEnv, writeFakeClaudeState, type FakeClaudeState } from './fake-claude-code';
import { startFakeAdoServer, type FakeAdoServer } from './fake-ado-server';

/**
 * The real app on the team board (E14): the fake organisation's artboard 08 board (and any extra
 * work items), a registered `onsite-companion` repo whose origin is the fake's Azure Repos URL, the
 * `claude` stand-in, and Azure DevOps and Claude connected. Nothing leaves the machine.
 *
 * The fake serves no git, so the origin URL is rewritten to a local bare repo with `url.<bare>.insteadOf`:
 * `git config remote.origin.url` still names the fake's repo (so PRs from it count as registered,
 * AL-232), while fetches and pushes go to the bare repo. Git never prompts for credentials.
 */
export interface TeamBoardApp {
  readonly app: ElectronApplication;
  readonly page: Page;
  readonly ado: FakeAdoServer;
  readonly root: string;
  readonly repo: string;
  /** The local bare repo standing in for the fake's `onsite-companion` repository. */
  readonly origin: string;
  invoke<T>(channel: string, payload?: unknown): Promise<Result<T>>;
  /** `tickets:list`, or throws. */
  tickets(): Promise<TicketSummary[]>;
  close(): Promise<void>;
}

export interface TicketSummary {
  id: string;
  stage: string;
  ado: { workItemId: number } | null;
  branch: string;
  worktreePath: string;
}

export interface TeamBoardAppOptions {
  /** Names the temp folder. */
  name: string;
  /** The team org's work items instead of artboard 08's board alone. */
  teamItems?: FakeWorkItem[];
  /** The repo's agent limit. Default 4. */
  maxConcurrentAgents?: number;
  /** Branches to create on the origin from main (pull requests' source branches). */
  originBranches?: readonly string[];
  /** Extra state for the `claude` stand-in. */
  claude?: Omit<FakeClaudeState, 'login' | 'log'>;
}

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

export async function startTeamBoardApp(options: TeamBoardAppOptions): Promise<TeamBoardApp> {
  const ado = await startFakeAdoServer({ teamBoard: true, orgName: 'CompanionSystems', ...(options.teamItems ? { teamItems: options.teamItems } : {}) });
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), `agent-lanes-e2e-${options.name}-`)));
  const userDataDir = join(root, 'profile');
  mkdirSync(userDataDir);

  const origin = join(root, 'origin.git');
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', origin], { stdio: 'pipe' });
  const repo = join(root, 'onsite-companion');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init', '--quiet', '--initial-branch=main');
  git('config', 'user.name', 'Agent Lanes');
  git('config', 'user.email', 'e2e@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('commit', '--quiet', '--allow-empty', '-m', 'Initial');
  const remote = `${ado.orgUrl}/${encodeURIComponent(ADO_FIXTURE_PROJECT)}/_git/onsite-companion`;
  git('remote', 'add', 'origin', remote);
  git('config', `url.${pathToFileURL(origin).href}.insteadOf`, remote);
  git('push', '--quiet', 'origin', 'main');
  for (const branch of options.originBranches ?? []) git('push', '--quiet', 'origin', `main:refs/heads/${branch}`);
  git('fetch', '--quiet', 'origin');

  const repoSettings: RepoSettings = {
    path: repo,
    name: 'onsite-companion',
    baseBranch: 'main',
    worktreeRoot: join(root, '.agent-lanes'),
    buildCommand: null,
    runCommand: null,
    maxConcurrentAgents: options.maxConcurrentAgents ?? 4,
  };
  writeFileSync(
    join(userDataDir, 'settings.json'),
    JSON.stringify({ version: 2, repos: [repoSettings], ui: { lastRepo: repo, lastSprint: null, collapsedLanes: ['done'], embedModeByTicket: {} } }),
  );
  const stateFile = join(root, 'fake-claude-state.json');
  writeFakeClaudeState(stateFile, { ...options.claude, login: FAKE_LOGIN, log: join(root, 'fake-claude-starts.jsonl') });

  const app = await electron.launch({
    args: [join(__dirname, '..', '..')],
    env: {
      ...process.env,
      AGENT_LANES_USER_DATA_DIR: userDataDir,
      CLAUDE_CONFIG_DIR: join(root, 'claude-config'),
      // A git that wanted credentials would wait on a prompt nobody answers.
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'Never',
      ...fakeClaudeEnv(stateFile),
    },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));
  await expect(page.getByText('Agent board')).toBeVisible();

  const invoke = <T>(channel: string, payload?: unknown) =>
    page.evaluate(
      ([name, body]) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name as string, body),
      [channel, payload] as const,
    ) as Promise<Result<T>>;

  expect(await invoke('connections:save', { kind: 'ado', orgUrl: ado.orgUrl, pat: ado.pat, defaultProject: ADO_FIXTURE_PROJECT })).toMatchObject({ ok: true });
  // The token test returns the identity "Assign to me" and the board's "Me" use (TB§6).
  expect(await invoke('connections:test', { id: 'ado:companionsystems' })).toMatchObject({ ok: true, data: { status: 'ok' } });
  expect(await invoke('connections:save', { kind: 'claude', mode: 'login' })).toMatchObject({ ok: true });

  return {
    app,
    page,
    ado,
    root,
    repo,
    origin,
    invoke,
    async tickets() {
      const result = await invoke<TicketSummary[]>('tickets:list');
      if (!result.ok) throw new Error(`tickets:list failed: ${result.message}`);
      return result.data;
    },
    async close() {
      await app.close();
      await ado.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    },
  };
}
