import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { Lane, TicketRecord } from '@agent-lanes/contracts';

/**
 * The board's lanes (AL-143) and cards (AL-144) in the real app: ticket records written to the
 * profile before start-up come back as cards in their lanes over `tickets:list`, and a collapsed
 * lane stays collapsed after a restart. Screenshots at artboard 1's 1440 × 960 go to test-results.
 */

const START = 1_760_000_000_000;

function record(id: string, stage: Lane, title: string, at: number, model: TicketRecord['model'] = 'opus', effort: TicketRecord['effort'] = 'high'): TicketRecord {
  return {
    version: 1,
    id,
    title,
    ado: { orgUrl: 'https://dev.azure.com/contoso', project: 'OnSite Companion', workItemId: Number(id) },
    repo: 'C:\\src\\onsite-companion',
    baseBranch: 'main',
    branch: `${id}-board-test`,
    worktreePath: `C:\\src\\.agent-lanes\\${id}`,
    subBranches: [],
    stage,
    stageHistory: stage === 'queued' ? [{ stage, at }] : [{ stage: 'queued', at: START }, { stage, at }],
    gates: { planning: 'approval', implementing: 'auto', 'code-review': 'auto', qa: 'auto', 'create-pr': 'approval' },
    model,
    effort,
    skills: [],
    sessionId: null,
    lastBuild: null,
    lastRun: null,
    design: { canvas: null, lastViewUrl: null, specs: [] },
    createdAt: START,
    updatedAt: at,
  };
}

/** Artboard 1's tickets. */
const BOARD: TicketRecord[] = [
  record('71330', 'queued', 'Asset register paging slow above 5k rows', START + 1, 'sonnet', 'medium'),
  record('71322', 'planning', 'Add PO number to invoice print layout', START + 2),
  record('71273', 'implementing', 'Cutover frmJobControl to Blazor', START + 3, 'opus', 'xhigh'),
  record('71288', 'implementing', 'Job grid filter drops date range', START + 4, 'sonnet', 'high'),
  record('71301', 'code-review', 'Defect request accept modal', START + 5),
  record('71310', 'qa', 'Timesheet export times out', START + 6, 'sonnet', 'medium'),
  record('71266', 'create-pr', 'Supplier portal login redirect loop', START + 7, 'haiku', 'low'),
];

let userDataDir: string;
let app: ElectronApplication | undefined;

async function launch(): Promise<Page> {
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));
  await expect(page.getByText('Agent board')).toBeVisible();
  return page;
}

test.beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-board-'));
  const folder = join(userDataDir, 'tickets', 'onsite-companion-0123456789ab');
  mkdirSync(folder, { recursive: true });
  for (const ticket of BOARD) writeFileSync(join(folder, `${ticket.id}.json`), `${JSON.stringify(ticket, null, 2)}\n`);
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  rmSync(userDataDir, { recursive: true, force: true });
});

test('shows every ticket record as a card in its lane, as on artboard 1', async () => {
  const page = await launch();

  const lane = (name: string) => page.getByTestId(`lane-${name}`);
  await expect(lane('implementing').getByRole('button', { name: /^#71273, Cutover frmJobControl to Blazor/ })).toBeVisible();
  await expect(lane('implementing').getByRole('button', { name: /^#71288/ })).toBeVisible();
  await expect(lane('queued').getByText('Waiting for a free slot')).toBeVisible();
  await expect(lane('qa').getByText('Timesheet export times out')).toBeVisible();
  await expect(lane('create-pr').getByText('Haiku · Low')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Implementing, 2 tickets. Collapse lane' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Done · merged this sprint, 0 tickets/ })).toBeVisible();

  // All seven lanes fit side by side at 1440 px, so nothing scrolls sideways.
  const scroll = await page.getByTestId('board-lanes').evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(scroll.scroll).toBeLessThanOrEqual(scroll.client);
  await page.screenshot({ path: test.info().outputPath('board-1440x960.png') });

  // Narrower than the lanes' minimum width, the row scrolls instead of squeezing the cards.
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1024, 768));
  await expect
    .poll(() => page.getByTestId('board-lanes').evaluate((element) => element.scrollWidth > element.clientWidth))
    .toBe(true);

  // A card opens its drill-in.
  await lane('qa').getByRole('button', { name: /^#71310/ }).click();
  await expect(page.getByText('Agent board')).toBeHidden();
});

test('keeps a lane collapsed after a restart', async () => {
  let page = await launch();
  await page.getByRole('button', { name: 'Planning, 1 ticket. Collapse lane' }).click();
  await expect(page.getByRole('button', { name: 'Planning, 1 ticket. Expand lane' })).toBeVisible();
  await app?.close();
  app = undefined;

  page = await launch();
  await expect(page.getByRole('button', { name: 'Planning, 1 ticket. Expand lane' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Done · merged this sprint, 0 tickets\. Expand lane$/ })).toBeVisible();
});

test('shows the live dock at the bottom, fed by events from main', async () => {
  const page = await launch();
  const dock = page.getByTestId('live-dock');
  await expect(dock.getByText('Live', { exact: true })).toBeVisible();
  await expect(page.getByTestId('live-dock-builds')).toHaveText('Builds 0');
  await expect(page.getByTestId('live-dock-sub-agents')).toHaveText('Sub-agents 0');

  const box = await dock.boundingBox();
  expect(box && Math.round(box.y + box.height)).toBe(960 - 24);

  // A build starting in main reaches the dock through `build:queued` and the agent ticket store.
  await app?.evaluate(({ BrowserWindow }, at) => {
    BrowserWindow.getAllWindows()[0]?.webContents.mainFrame.send('build:queued', {
      jobId: 'job-1',
      ticketId: '71273',
      kind: 'build',
      state: 'running',
      position: null,
      queuedAt: at,
      startedAt: at,
      finishedAt: null,
      at,
    });
  }, START + 100);
  await expect(page.getByTestId('live-dock-builds')).toHaveText('Builds 1');
});
