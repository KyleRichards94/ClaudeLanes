import { expect, test, type Locator, type Page } from '@playwright/test';
import { artboard08Items, artboard11Backlog } from '@agent-lanes/ado-client/testing';
import type { Lane, TicketRecord } from '@agent-lanes/contracts';
import { buildGallery, launchGallery, type GalleryApp } from './support/gallery-build';
import { E2E_TICKET_START, e2eTicketRecord } from './support/ticket-records';
import { startTeamBoardApp, type TeamBoardApp } from './support/team-board-app';

/**
 * AL-223: every screen of the design brief captured at the artboards' 1440 × 960, in one running app
 * with artboard 1's tickets, the fake organisation's artboard 08 board and artboard 11's backlog, and
 * the `claude` stand-in. Each capture is attached to the report as `NN-<artboard>` for comparing side by
 * side with `docs/design/screens/NN-*.png`. Artboards 06 (card states) and 07 (design tokens) are
 * gallery sheets: the gallery build is started at the end and each sheet captured at its heading.
 *
 * The checks here only make sure each screen is the one the artboard draws; the comparison itself
 * is a person's (AL-223's sign-off).
 */

let board: TeamBoardApp;
let page: Page;

/** Artboard 1's tickets, one per lane and two in Implementing. */
function boardTickets(repo: string): TicketRecord[] {
  const ticket = (id: string, stage: Lane, title: string, step: number, model: TicketRecord['model'], effort: TicketRecord['effort']): TicketRecord =>
    e2eTicketRecord({
      id,
      title,
      stage,
      repo,
      branch: `${id}-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`,
      ado: { orgUrl: 'https://dev.azure.com/CompanionSystems', project: 'OnSite Companion', workItemId: Number(id) },
      stageHistory: stage === 'queued' ? [{ stage, at: E2E_TICKET_START + step }] : [{ stage: 'queued', at: E2E_TICKET_START }, { stage, at: E2E_TICKET_START + step }],
      model,
      effort,
      sessionId: null,
      updatedAt: E2E_TICKET_START + step,
    });
  return [
    ticket('71330', 'queued', 'Asset register paging slow above 5k rows', 1, 'sonnet', 'medium'),
    ticket('71322', 'planning', 'Add PO number to invoice print layout', 2, 'opus', 'high'),
    ticket('71273', 'implementing', 'Cutover frmJobControl to Blazor', 3, 'opus', 'xhigh'),
    ticket('71288', 'implementing', 'Job grid filter drops date range', 4, 'sonnet', 'high'),
    ticket('71301', 'code-review', 'Defect request accept modal', 5, 'opus', 'high'),
    ticket('71310', 'qa', 'Timesheet export times out', 6, 'sonnet', 'medium'),
    ticket('71266', 'create-pr', 'Supplier portal login redirect loop', 7, 'haiku', 'low'),
  ];
}

/** Saves the window as `NN-name-1440x960.png` and attaches it to the report. */
async function capture(name: string): Promise<void> {
  const path = test.info().outputPath(`${name}-1440x960.png`);
  await page.screenshot({ path });
  await test.info().attach(name, { path, contentType: 'image/png' });
}

async function openHash(hash: string): Promise<void> {
  await page.evaluate((next) => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = next;
  }, hash);
}

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Picks the card up with the pointer and holds it over the lane. */
async function holdOver(card: Locator, lane: string): Promise<void> {
  const from = await center(card);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y - 10, { steps: 3 });
  const box = await page.getByTestId(`lane-${lane}`).boundingBox();
  if (!box) throw new Error(`lane ${lane} is not visible`);
  await page.mouse.move(box.x + box.width / 2, box.y + 80, { steps: 8 });
  await expect(page.getByTestId(`lane-${lane}`)).toHaveCSS('border-top-style', 'solid');
}

async function letGo(): Promise<void> {
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByTestId('drag-status')).toHaveCount(0);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const items = artboard08Items();
  const ids = new Set(items.map((item) => item.id));
  board = await startTeamBoardApp({
    name: 'visual-qa',
    teamItems: [...items, ...artboard11Backlog().filter((item) => !ids.has(item.id))],
    tickets: boardTickets,
  });
  page = board.page;
  await expect(page.getByTestId('lane-implementing').getByText('Cutover frmJobControl to Blazor')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('team-pr-10571')).toBeVisible({ timeout: 20_000 });
});

test.afterAll(async () => {
  await board?.close();
});

test('01 · the board', async () => {
  await page.getByTestId('board-lanes').scrollIntoViewIfNeeded();
  await page.mouse.wheel(0, -2000);
  await expect(page.getByRole('heading', { name: 'Agent board', level: 1 })).toBeInViewport();
  await capture('01-board');
});

test('02 · New agent ticket', async () => {
  await page.getByRole('button', { name: 'New agent ticket' }).click();
  const dialog = page.getByRole('dialog', { name: 'New agent ticket' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /^#71287/ })).toBeVisible({ timeout: 20_000 });
  await capture('02-new-agent-ticket');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('03 · ticket drill-in', async () => {
  await openHash('#/ticket/71273');
  await expect(page.getByTestId('stage-stepper')).toBeVisible();
  await capture('03-ticket-drill-in');
});

test('04 · Claude Design tab', async () => {
  await openHash('#/ticket/71273/design');
  await expect(page.getByTestId('design-browser-bar')).toBeVisible();
  await capture('04-claude-design-tab');
  await openHash('#/board');
  await expect(page.getByRole('heading', { name: 'Agent board', level: 1 })).toBeVisible();
});

test('05 · Connections', async () => {
  await page.getByRole('button', { name: 'Connections' }).click();
  const dialog = page.getByRole('dialog', { name: 'Connections' });
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('connection-ado:companionsystems')).toBeVisible();
  await capture('05-connections');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('08 · the team board under the lanes', async () => {
  await page.getByTestId('team-board').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('team-card-71318')).toBeInViewport();
  await capture('08-team-board');
});

test('09 · dragging your PR !10571', async () => {
  await holdOver(page.getByTestId('team-pr-10571'), 'implementing');
  await expect(page.getByTestId('lane-code-review-drop-hint')).toBeVisible();
  await capture('09-team-board-dragging-pr');
  await letGo();
});

test('10 · after dropping Failed #71318 on Planning', async () => {
  await holdOver(page.getByTestId('team-card-71318'), 'planning');
  await page.mouse.up();
  await expect(page.getByTestId('toast-launch-from-ado:71318')).toContainText('Agent started in Planning', { timeout: 30_000 });
  await expect(page.getByTestId('lane-planning').getByTestId('card-71318')).toBeVisible();
  await capture('10-team-board-after-drop');
});

test('11 · the Backlog popout', async () => {
  await page.getByTestId('team-board-backlog').click();
  await expect(page.getByTestId('backlog-row-71360')).toBeVisible({ timeout: 20_000 });
  await page.mouse.move(8, 8);
  await capture('11-backlog-popout');
});

test('12 · dragging two selected backlog rows', async () => {
  await page.getByTestId('backlog-row-71360-select').click();
  // Artboard 12 selects #71335 too; here that id is the board's item, so the next row stands in.
  await page.getByTestId('backlog-row-71362-select').click();
  await holdOver(page.getByTestId('backlog-row-71360'), 'planning');
  await expect(page.getByTestId('drag-status')).toContainText('Dragging 2 items');
  await capture('12-backlog-dragging');
  await letGo();
});

test.describe('gallery sheets', () => {
  let gallery: GalleryApp;

  test.beforeAll(async () => {
    test.setTimeout(180_000);
    buildGallery();
    gallery = await launchGallery();
    page = await gallery.app.firstWindow();
    await gallery.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));
    await expect(page.getByText('Agent board')).toBeVisible();
    await openHash('#/gallery');
    await expect(page.getByTestId('gallery-page')).toBeVisible();
  });

  test.afterAll(async () => {
    await gallery?.close();
  });

  test('06 · agent card states', async () => {
    const heading = page.getByRole('heading', { name: 'Agent card states' });
    await heading.scrollIntoViewIfNeeded();
    await heading.evaluate((element) => (element as unknown as { scrollIntoView(options: object): void }).scrollIntoView({ block: 'start' }));
    await capture('06-card-states');
  });

  test('07 · design tokens', async () => {
    const heading = page.getByRole('heading', { name: 'Design tokens' });
    await heading.scrollIntoViewIfNeeded();
    await heading.evaluate((element) => (element as unknown as { scrollIntoView(options: object): void }).scrollIntoView({ block: 'start' }));
    await capture('07-design-tokens');
  });
});
