import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
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

test('the header shows live counts, the legend and the Repo menu (AL-142)', async () => {
  const page = await launch();
  const header = page.getByTestId('board-header');
  await expect(header.getByText('6 running')).toBeVisible();
  await expect(header.getByText('0 need you')).toBeVisible();
  await expect(header.getByText('1 queued')).toBeVisible();
  await expect(page.getByTestId('board-subheader')).toHaveText(/7 agent tickets$/);
  await expect(page.getByTestId('board-legend')).toContainText('Azure DevOps');
  await expect(page.getByTestId('board-count-needs-you')).toBeDisabled();

  // No event sets a needs-you reason yet (AL-104, AL-109), so the filter itself is covered by BoardPage.test.
  await expect(page.getByRole('button', { name: 'Repo: Add a repo' })).toBeVisible();
  await page.getByRole('button', { name: 'Repo: Add a repo' }).click();
  await expect(page.getByRole('menu', { name: 'Repo' }).getByRole('menuitem', { name: 'Add repo…' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.getByTestId('board-header').screenshot({ path: test.info().outputPath('board-header.png') });
});

test('a right-click on a card opens its menu, and Move to stage… moves the card (AL-270)', async () => {
  const page = await launch();
  const card = page.getByTestId('lane-implementing').getByRole('button', { name: /^#71288/ });
  await card.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Ticket actions' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Open worktree folder' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Copy branch name' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Remove from board…' })).toBeVisible();

  await menu.getByRole('menuitem', { name: 'Move to stage…' }).click();
  const modal = page.getByTestId('move-stage-modal');
  await expect(modal).toBeVisible();
  // QA, not Done: the Done lane is collapsed by default and draws no cards.
  await modal.getByRole('radio', { name: 'QA', exact: true }).click();
  await modal.getByTestId('move-stage-confirm').click();
  await expect(modal).toBeHidden();
  await expect(page.getByTestId('lane-qa').getByRole('button', { name: /^#71288/ })).toBeVisible();
  await expect(page.getByTestId('lane-implementing').getByRole('button', { name: /^#71288/ })).toHaveCount(0);

  // The corner chevron opens the same menu.
  await page.getByTestId('ticket-menu-71273').click();
  await expect(page.getByRole('menu', { name: 'Ticket actions' })).toBeVisible();
  await page.keyboard.press('Escape');
});

/** The centre of an element in page coordinates. */
async function middle(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('an agent card drags to any lane but Queued; a PR card only to Done (AL-274)', async () => {
  const page = await launch();
  const card = page.getByTestId('lane-implementing').getByRole('button', { name: /^#71288/ });
  const from = await middle(card);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y - 10, { steps: 3 });
  await expect(page.getByTestId('drag-status')).toHaveText('Drop #71288 on a highlighted lane');
  await expect(page.getByTestId('lane-qa-drop-hint')).toContainText('Move to QA');
  // Done is collapsed by default, so its strip takes the drop without a hint; Create PR shows one.
  await expect(page.getByTestId('lane-create-pr-drop-hint')).toContainText('Move to Create PR');
  await expect(page.getByTestId('lane-queued-drop-hint')).toHaveCount(0);
  await expect(page.getByTestId('lane-implementing-drop-hint')).toHaveCount(0);

  const qa = page.getByTestId('lane-qa');
  const over = await middle(qa);
  await page.mouse.move(over.x, over.y, { steps: 8 });
  await page.mouse.up();
  await expect(qa.getByRole('button', { name: /^#71288/ })).toBeVisible();
  await expect(page.getByTestId('lane-implementing').getByRole('button', { name: /^#71288/ })).toHaveCount(0);
});

test('the Digest ranks every ticket by what it needs and offers Open and Resume (AL-272)', async () => {
  const page = await launch();
  await page.getByTestId('open-digest').click();
  const digest = page.getByTestId('board-digest-modal');
  await expect(digest).toBeVisible();
  await expect(digest.getByRole('listitem')).toHaveCount(7);
  // Nothing has run in this profile: every ticket says no agent is running, the queued one that it waits for a slot.
  await expect(digest.getByTestId('board-digest-71330-reasons')).toHaveText('Waiting for a free slot');
  await expect(digest.getByTestId('board-digest-71273-reasons')).toHaveText('No agent running');
  await expect(digest.getByTestId('board-digest-71273-resume')).toBeVisible();
  // Without a Claude connection, next actions say so instead of hanging.
  await digest.getByTestId('board-digest-generate').click();
  await expect(digest.getByTestId('board-digest-error')).toContainText('Connect Claude in Connections');
  await digest.getByTestId('board-digest-71310-open').click();
  await expect(page.getByText('Agent board')).toBeHidden();
});
