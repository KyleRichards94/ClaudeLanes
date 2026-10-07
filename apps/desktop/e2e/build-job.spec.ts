import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { BuildLogEvent, BuildResult, RepoSettings, Result, TicketRecord } from '@agent-lanes/contracts';

/**
 * AL-132 in the real app: Build runs the repo's build command in the ticket's worktree, streams
 * `build:log` batches, reads the errors off the log, fails with BUILD_FAILED and the counts, and stores
 * the last build on the ticket record.
 */

const START = 1_760_000_000_000;

type Bridge = {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
  on(channel: string, listener: (payload: unknown) => void): () => void;
};

let app: ElectronApplication | undefined;
let root: string;
let userDataDir: string;

function invoke<T>(page: Page, channel: string, payload?: unknown): Promise<Result<T>> {
  return page.evaluate(
    ([name, body]) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name, body),
    [channel, payload] as const,
  ) as Promise<Result<T>>;
}

function ticketRecord(repo: string, worktreePath: string): TicketRecord {
  return {
    version: 1,
    id: '71273',
    title: 'Cutover frmJobControl to Blazor',
    ado: null,
    repo,
    baseBranch: 'main',
    branch: '71273-cutover-frmjobcontrol-to',
    worktreePath,
    subBranches: [],
    stage: 'implementing',
    stageHistory: [{ stage: 'implementing', at: START }],
    gates: { planning: 'approval', implementing: 'auto', 'code-review': 'auto', qa: 'auto', 'create-pr': 'approval' },
    model: 'opus',
    effort: 'xhigh',
    skills: [],
    sessionId: null,
    lastBuild: null,
    lastRun: null,
    design: { canvas: null, lastViewUrl: null, specs: [] },
    createdAt: START,
    updatedAt: START,
  };
}

test.beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-build-')));
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-build-profile-'));
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(userDataDir, { recursive: true, force: true });
});

test('a failing build streams its log, fails with "Build failed · 3 errors" and stores the last build', async () => {
  const repo = join(root, 'onsite');
  const worktree = join(root, '.agent-lanes', '71273');
  mkdirSync(repo, { recursive: true });
  mkdirSync(worktree, { recursive: true });
  writeFileSync(
    join(worktree, 'build.js'),
    [
      "console.log('Build started.');",
      "console.log(\"JobControl.razor.cs(42,17): error CS0246: The type or namespace name 'JobFilterState' could not be found [OnSite.csproj]\");",
      "console.log(\"JobGrid.razor.cs(8,3): error CS0103: The name 'grid' does not exist in the current context [OnSite.csproj]\");",
      "console.log('Startup.cs(9,9): error CS1002: ; expected [OnSite.csproj]');",
      "console.log('Build FAILED.');",
      "console.log(\"JobControl.razor.cs(42,17): error CS0246: The type or namespace name 'JobFilterState' could not be found [OnSite.csproj]\");",
      'process.exit(1);',
    ].join('\n'),
  );
  const ticketsDir = join(userDataDir, 'tickets', 'onsite-0123456789ab');
  mkdirSync(ticketsDir, { recursive: true });
  writeFileSync(join(ticketsDir, '71273.json'), JSON.stringify(ticketRecord(repo, worktree), null, 2));

  const repoSettings: RepoSettings = {
    path: repo,
    name: 'onsite',
    baseBranch: 'main',
    worktreeRoot: join(root, '.agent-lanes'),
    buildCommand: 'node build.js',
    runCommand: null,
    maxConcurrentAgents: 4,
  };
  // Repos are only registered through the folder picker, so the profile starts with this one.
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ version: 2, repos: [repoSettings] }));

  app = await electron.launch({ args: [join(__dirname, '..')], env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir } });
  const page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();

  await page.evaluate(() => {
    const store = ((globalThis as Record<string, unknown>)['__buildLog'] = [] as unknown[]);
    (globalThis as unknown as { agentLanes: Bridge }).agentLanes.on('build:log', (payload) => store.push(payload));
  });

  const result = await invoke<BuildResult>(page, 'build:start', { ticketId: '71273' });
  expect(result).toMatchObject({ ok: false, code: 'BUILD_FAILED', message: 'Build failed · 3 errors' });
  expect((result as { details: BuildResult }).details).toMatchObject({ outcome: 'failed', exitCode: 1, errors: 3, warnings: 0 });

  const batches = (await page.evaluate(() => (globalThis as Record<string, unknown>)['__buildLog'])) as BuildLogEvent[];
  const lines = batches.flatMap((batch) => batch.lines);
  expect(lines.map((line) => line.text)).toContain('Build FAILED.');
  expect(lines.filter((line) => line.level === 'error').length).toBeGreaterThanOrEqual(4);

  // The record is saved on quit at the latest.
  await app.close();
  app = undefined;
  const saved = JSON.parse(readFileSync(join(ticketsDir, '71273.json'), 'utf8')) as TicketRecord;
  expect(saved.lastBuild).toMatchObject({ outcome: 'failed', errors: 3, firstError: { code: 'CS0246', line: 42 } });
});
