import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { RepoSettings, TicketRecord } from '@agent-lanes/contracts';

/**
 * AL-135 in the real app: a build that prints 50,000 lines streams into the ticket's Build log, which
 * draws only the rows near the view, colours errors and warnings, jumps to the next error, and
 * scrolls the whole log smoothly.
 */

const START = 1_760_000_000_000;
const LINES = 50_000;

type Bridge = { invoke(channel: string, payload?: unknown): Promise<unknown> };

let app: ElectronApplication | undefined;
let root: string;
let userDataDir: string;

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
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-buildlog-')));
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-buildlog-profile-'));
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(userDataDir, { recursive: true, force: true });
});

async function launch(): Promise<Page> {
  const repo = join(root, 'onsite');
  const worktree = join(root, '.agent-lanes', '71273');
  mkdirSync(repo, { recursive: true });
  mkdirSync(worktree, { recursive: true });
  // 50,000 lines: an MSBuild error every 12,500 lines and a warning every 5,000.
  writeFileSync(
    join(worktree, 'build.js'),
    [
      'const out = [];',
      `for (let n = 0; n < ${LINES}; n++) {`,
      "  if (n > 0 && n % 12500 === 0) out.push(`Job${n}.cs(42,17): error CS0246: The type or namespace name 'Missing${n}' could not be found [OnSite.csproj]`);",
      "  else if (n % 5000 === 1) out.push(`Job${n}.cs(8,3): warning CS0168: The variable 'unused' is declared but never used [OnSite.csproj]`);",
      '  else out.push(`line ${n}`);',
      '}',
      "process.stdout.write(out.join('\\n') + '\\n', () => process.exit(1));",
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
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ version: 2, repos: [repoSettings] }));

  app = await electron.launch({ args: [join(__dirname, '..')], env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir } });
  const page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
  await page.evaluate(() => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = '#/ticket/71273';
  });
  // The log lives in the drill-in's Build log tab (AL-170).
  await page.getByRole('tab', { name: 'Build log' }).click();
  await expect(page.getByTestId('build-log')).toBeVisible();
  return page;
}

test('a 50,000-line build log streams in, highlights errors and scrolls smoothly', async () => {
  const page = await launch();
  const log = page.getByTestId('build-log');
  const lines = page.getByTestId('build-log-lines');
  const drawn = page.locator('[data-testid="build-log-info"], [data-testid="build-log-warning"], [data-testid="build-log-error"], [data-testid="build-log-header"]');

  await page.evaluate(() => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke('build:start', { ticketId: '71273' }));

  // Follow tail is on: the last line arrives in view.
  await expect(log.getByText(`line ${LINES - 1}`, { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(log.getByText('3 errors')).toBeVisible();
  await expect(log.getByText('10 warnings')).toBeVisible();
  expect(await drawn.count()).toBeLessThan(200);

  // Jump to next error from the tail wraps round to the first error.
  await log.getByRole('button', { name: /Next error/ }).click();
  await expect(log.getByText(/Job12500\.cs\(42,17\): error CS0246/)).toBeVisible();
  await expect(log.getByRole('switch', { name: 'Follow tail' })).toHaveAttribute('aria-checked', 'false');
  await log.getByRole('button', { name: /Next error/ }).click();
  await expect(log.getByText(/Job25000\.cs\(42,17\): error CS0246/)).toBeVisible();

  // Scroll the whole log top to bottom with the wheel, timing every frame.
  await lines.evaluate((node) => node.scrollTo({ top: 0 }));
  await expect(log.getByText('line 0', { exact: true })).toBeVisible();
  // The drill-in scrolls (AL-170): bring the whole log into the window so the wheel lands on it.
  await lines.scrollIntoViewIfNeeded();
  const box = (await lines.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => {
    const scope = globalThis as unknown as { __frames: number[]; __recording: boolean; requestAnimationFrame(tick: (now: number) => void): number };
    scope.__frames = [];
    scope.__recording = true;
    let last = performance.now();
    const tick = (now: number) => {
      scope.__frames.push(now - last);
      last = now;
      if (scope.__recording) scope.requestAnimationFrame(tick);
    };
    scope.requestAnimationFrame(tick);
  });
  const contentHeight = await lines.evaluate((node) => node.scrollHeight);
  const step = 4_000;
  for (let y = 0; y < contentHeight; y += step) await page.mouse.wheel(0, step);
  // Chromium can coalesce wheel events; finish the trip to the end of the log.
  const atEnd = () => lines.evaluate((node) => node.scrollTop + node.clientHeight >= node.scrollHeight - 1);
  for (let extra = 0; extra < 100 && !(await atEnd()); extra += 1) await page.mouse.wheel(0, step);
  const frames = await page.evaluate(() => {
    const scope = globalThis as unknown as { __frames: number[]; __recording: boolean };
    scope.__recording = false;
    return scope.__frames.slice(1);
  });

  await expect(log.getByText(`line ${LINES - 1}`, { exact: true })).toBeVisible();
  expect(await drawn.count()).toBeLessThan(200);
  const sorted = [...frames].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const p95 = sorted[Math.floor(sorted.length * 0.95)]!;
  console.log(`build log scroll: ${frames.length} frames, median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
  // Smooth: frames keep a display's pace, with headroom for a busy CI machine.
  expect(median).toBeLessThan(34);
  expect(p95).toBeLessThan(100);
});
