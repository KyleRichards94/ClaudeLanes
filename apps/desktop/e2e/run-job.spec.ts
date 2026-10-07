import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { BuildLogEvent, RepoSettings, Result, RunList, RunStatus, TicketRecord } from '@agent-lanes/contracts';

/**
 * AL-133 in the real app: two tickets run the same web app side by side, each on its own free port,
 * and the run's URL is read from what the app prints. AL-134: Stop and quitting the app leave no
 * orphan node process behind.
 */

const START = 1_760_000_000_000;
const TICKETS = ['71273', '71288'] as const;

const SERVER = `
const http = require('http');
const path = require('path');
const name = path.basename(process.cwd());
// A helper process under the server, the way dotnet run sits above the app it starts.
require('child_process').spawn(process.execPath, ['-e', 'console.log("pid=" + process.pid); setInterval(() => {}, 1000)'], { stdio: 'inherit' });
const server = http.createServer((req, res) => res.end('served from ' + name));
server.listen(Number(process.env.PORT), '127.0.0.1', () => {
  console.log('pid=' + process.pid);
  console.log('Now listening on: http://localhost:' + server.address().port);
});
`;

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

function ticketRecord(id: string, repo: string, worktreePath: string): TicketRecord {
  return {
    version: 1,
    id,
    title: `Ticket ${id}`,
    ado: null,
    repo,
    baseBranch: 'main',
    branch: `${id}-web`,
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

/** Pids the test servers printed, so they are ended even if the app is not. */
async function serverPids(page: Page): Promise<number[]> {
  const batches = (await page.evaluate(() => (globalThis as Record<string, unknown>)['__runLog'] ?? [])) as BuildLogEvent[];
  return batches.flatMap((batch) => batch.lines.map((line) => /^pid=(\d+)$/.exec(line.text)?.[1]).filter((pid): pid is string => !!pid).map(Number));
}

let pids: number[] = [];

test.beforeEach(() => {
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-run-')));
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-run-profile-'));
  pids = [];
});

test.afterEach(async () => {
  // Quitting stops the runs (AL-134); this is a fallback so a failed test never leaves a server behind,
  // since on Windows a live server holds the app's inherited stdio handles and close would wait for it.
  if (app) pids = [...pids, ...(await serverPids(await app.firstWindow()).catch(() => []))];
  for (const pid of new Set(pids)) {
    try {
      process.kill(pid);
    } catch {
      // Already gone.
    }
  }
  await app?.close();
  app = undefined;
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  rmSync(userDataDir, { recursive: true, force: true });
});

/** Two tickets of one web repo, each with the server in its worktree; launches the app and records build:log. */
async function launchWithTwoTickets(): Promise<Page> {
  const repo = join(root, 'web');
  mkdirSync(repo);
  const ticketsDir = join(userDataDir, 'tickets', 'web-0123456789ab');
  mkdirSync(ticketsDir, { recursive: true });
  for (const id of TICKETS) {
    const worktree = join(root, '.agent-lanes', id);
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, 'server.js'), SERVER);
    writeFileSync(join(ticketsDir, `${id}.json`), JSON.stringify(ticketRecord(id, repo, worktree), null, 2));
  }
  const repoSettings: RepoSettings = {
    path: repo,
    name: 'web',
    baseBranch: 'main',
    worktreeRoot: join(root, '.agent-lanes'),
    buildCommand: null,
    runCommand: 'node server.js',
    maxConcurrentAgents: 4,
  };
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ version: 2, repos: [repoSettings] }));

  app = await electron.launch({ args: [join(__dirname, '..')], env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir } });
  const page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
  await page.evaluate(() => {
    const store = ((globalThis as Record<string, unknown>)['__runLog'] = [] as unknown[]);
    (globalThis as unknown as { agentLanes: Bridge }).agentLanes.on('build:log', (payload) => store.push(payload));
  });
  return page;
}

/** Starts both tickets and waits until each listens and its server and helper pids are known. */
async function runBoth(page: Page): Promise<RunStatus[]> {
  for (const id of TICKETS) {
    expect(await invoke<RunStatus>(page, 'run:start', { ticketId: id })).toMatchObject({ ok: true, data: { ticketId: id } });
  }
  let runs: RunStatus[] = [];
  await expect
    .poll(async () => {
      const listed = await invoke<RunList>(page, 'run:list');
      runs = listed.ok ? listed.data.runs : [];
      return runs.filter((run) => run.state === 'running' && run.url !== null).length;
    })
    .toBe(2);
  await expect.poll(async () => (pids = await serverPids(page)).length, { timeout: 10_000 }).toBe(4);
  return runs;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    return (cause as NodeJS.ErrnoException).code === 'EPERM';
  }
}

test('two tickets run the same web app side by side on different ports', async () => {
  const page = await launchWithTwoTickets();
  const runs = await runBoth(page);

  const [first, second] = TICKETS.map((id) => runs.find((run) => run.ticketId === id)!);
  expect(first!.port).not.toBe(second!.port);
  for (const [id, run] of [[TICKETS[0], first!], [TICKETS[1], second!]] as const) {
    expect(run.url).toBe(`http://localhost:${run.port}/`);
    const response = await fetch(`http://127.0.0.1:${run.port}/`);
    expect(await response.text()).toBe(`served from ${id}`);
  }
});

test('Stop and quitting leave no orphan node processes', async () => {
  const page = await launchWithTwoTickets();
  await runBoth(page);
  expect(pids.every(isAlive)).toBe(true);

  // Stop ends the first ticket's tree; the second keeps running.
  const before = new Set(pids);
  expect(await invoke(page, 'run:stop', { ticketId: TICKETS[0] })).toEqual({ ok: true, data: { stopped: true } });
  const listed = await invoke<RunList>(page, 'run:list');
  expect(listed.ok && listed.data.runs.find((run) => run.ticketId === TICKETS[0])?.state).toBe('stopped');
  const stillAlive = [...before].filter(isAlive);
  expect(stillAlive).toHaveLength(2);

  // Quitting stops every run the app started.
  await app!.close();
  app = undefined;
  await expect.poll(() => [...before].filter(isAlive)).toEqual([]);
});
