import { expect, test, type Locator, type Page } from '@playwright/test';
import { artboard08Items, artboard11Backlog } from '@agent-lanes/ado-client/testing';
import { seriousAxeViolations } from './support/accessibility';
import { startTeamBoardApp, type TeamBoardApp } from './support/team-board-app';

/**
 * AL-239 in the real app: the Backlog popout over the board (artboards 11 and 12) against the fake
 * organisation's artboard 08 board plus artboard 11's backlog, with the `claude` stand-in. Two selected
 * rows dragged onto Planning start two agents; the repo allows one at a time, so the second is Queued.
 * Pop out opens the backlog in its own window, whose rows land on the main window's lanes by native drag.
 *
 * Artboards 08 and 11 share some ids (#71335 and a few of the generated 714xx rows); the board's
 * items win here, so the backlog holds a few fewer than artboard 11's 48.
 */

let board: TeamBoardApp;
let page: Page;
/** What the Backlog button counts. */
let backlogTotal: number;

const tickets = () => board.tickets();

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const popout = () => page.getByTestId('backlog-popout');
const dialog = () => page.getByRole('dialog', { name: 'Backlog' });

async function openBacklog(): Promise<void> {
  await page.getByTestId('team-board-backlog').click();
  await expect(dialog()).toBeVisible();
  await expect(page.getByTestId('backlog-row-71360')).toBeVisible({ timeout: 20_000 });
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const items = artboard08Items();
  const boardIds = new Set(items.map((item) => item.id));
  board = await startTeamBoardApp({
    name: 'backlog',
    teamItems: [...items, ...artboard11Backlog().filter((item) => !boardIds.has(item.id))],
    // One agent at a time: the second of two dropped rows goes to Queued (TB§5).
    maxConcurrentAgents: 1,
  });
  page = board.page;
  await expect(page.getByTestId('team-board-backlog')).toHaveText(/Backlog \d+/, { timeout: 20_000 });
  backlogTotal = Number((await page.getByTestId('team-board-backlog').textContent())?.replace(/\D/g, ''));
  expect(backlogTotal).toBeGreaterThan(40);
});

test.afterAll(async () => {
  await board?.close();
});

test('Backlog opens a popout over the board, grouped by Feature (artboard 11)', async () => {
  await openBacklog();
  await expect(page.getByTestId('backlog-popout-subtitle')).toHaveText(`OSC Developers · ${backlogTotal} items · unassigned items can be dragged onto Planning or Implementing`);
  await expect(dialog().getByRole('heading', { level: 3 }).first()).toHaveText('Job management');
  await expect(page.getByTestId('backlog-row-71360')).toContainText('Bulk reassign jobs between technicians');
  await expect(page.getByTestId('backlog-row-71360')).toContainText('5 pts');
  await expect(page.getByRole('button', { name: 'Pop out' })).toBeVisible();
  // The lanes stay visible above it.
  await expect(page.getByTestId('lane-planning')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('backlog-popout-1440x960.png') });
  expect(await seriousAxeViolations(page)).toEqual([]);
});

test('filters narrow the rows, Escape closes it, and the filters are still set when it opens again', async () => {
  await dialog().getByRole('radio', { name: 'Bug' }).click();
  await expect(page.getByTestId('backlog-row-71362')).toBeVisible();
  await expect(page.getByTestId('backlog-row-71360')).toHaveCount(0);
  await page.getByLabel('Search the backlog').fill('archived');
  await expect(page.getByTestId('backlog-row-71377')).toHaveCount(0);
  await expect(page.getByTestId('backlog-row-71362')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(popout()).toHaveCount(0);
  await page.getByTestId('team-board-backlog').click();
  await expect(dialog().getByRole('radio', { name: 'Bug' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByLabel('Search the backlog')).toHaveValue('archived');

  await page.getByLabel('Search the backlog').fill('');
  await dialog().getByRole('radio', { name: 'All' }).click();
  await expect(page.getByTestId('backlog-row-71360')).toBeVisible();
  // A click on the board outside the modal closes it too.
  await page.mouse.click(40, 920);
  await expect(popout()).toHaveCount(0);
});

test('dragging two selected rows onto Planning starts two agents; the second waits in Queued (artboard 12)', async () => {
  await openBacklog();
  await page.getByTestId('backlog-row-71360-select').click();
  await page.getByTestId('backlog-row-71362-select').click();
  await expect(page.getByTestId('backlog-selection')).toContainText('2 selected · drag any of them to start one agent each');

  const from = await center(page.getByTestId('backlog-row-71362'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y - 10, { steps: 3 });
  await expect(page.getByTestId('drag-status')).toHaveText('Dragging 2 items — drop on Planning or Implementing');
  // TB§5: the modal fades to 35 % and lets the pointer through to the lanes.
  await expect(popout()).toHaveCSS('opacity', '0.35');
  await expect(popout()).toHaveCSS('pointer-events', 'none');
  await expect(page.getByTestId('lane-planning-drop-hint')).toContainText('Plan these');
  await expect(page.getByTestId('lane-implementing-drop-hint')).toContainText('Skip to implementing');
  await expect(page.getByTestId('lane-code-review-drop-hint')).toHaveCount(0);

  const planning = await center(page.getByTestId('lane-planning'));
  await page.mouse.move(planning.x, planning.y - 60, { steps: 8 });
  await expect(page.getByTestId('lane-planning')).toHaveCSS('border-top-style', 'solid');
  await page.screenshot({ path: test.info().outputPath('backlog-dragging-1440x960.png') });
  await page.mouse.up();

  // One agent per row: the first runs in Planning, the second waits for the repo's only slot.
  await expect.poll(async () => (await tickets()).map((ticket) => [ticket.ado?.workItemId, ticket.stage]).sort(), { timeout: 60_000 }).toEqual([
    [71360, 'planning'],
    [71362, 'queued'],
  ]);
  await expect(popout()).toHaveCSS('opacity', '1');
  // The rows stay in the list, tagged (TB§5).
  await expect(page.getByTestId('backlog-row-71360-agent')).toHaveText('Agent in Planning', { timeout: 20_000 });
  await expect(page.getByTestId('backlog-row-71362-agent')).toHaveText('Agent in Queued');
  // The one ADO change: each item assigned to the signed-in user and moved to In Progress (T5).
  for (const id of [71360, 71362]) {
    const item = board.ado.teamOrg!.state.workItems.items.find((candidate) => candidate.id === id);
    expect(item?.state).toBe('Active');
    expect(typeof item?.assignedTo === 'object' ? item.assignedTo.displayName : item?.assignedTo).toBe('Kyle Richards');
  }
});

test('Pop out moves the backlog to its own window; a row dragged from it lands on a lane in the main window', async () => {
  const opened = board.app.waitForEvent('window');
  await page.getByRole('button', { name: 'Pop out' }).click();
  const backlogWindow = await opened;
  await expect(popout()).toHaveCount(0);
  await expect(backlogWindow.getByTestId('backlog-row-71371')).toBeVisible({ timeout: 20_000 });
  expect(new URL(backlogWindow.url()).hash).toBe('#/backlog');
  await expect(backlogWindow.getByRole('button', { name: 'Pop out' })).toHaveCount(0);
  await expect(backlogWindow.getByTestId('backlog-row-71371')).toHaveAttribute('draggable', 'true');

  // The drag's data as the popped-out row puts it on the native drag (Playwright can't drag between windows).
  const data = (await backlogWindow.evaluate(dragStartScript('backlog-row-71371'))) as Record<string, string>;
  expect(Object.keys(data)).toContain('application/x-agent-lanes-backlog');

  // Over the main window's Planning lane the lanes light up; the drop starts the agent.
  await page.evaluate(dragEventsScript('lane-planning', ['dragenter', 'dragover'], data));
  await expect(page.getByTestId('lane-planning-drop-hint')).toContainText('Plan this');
  await page.evaluate(dragEventsScript('lane-planning', ['drop'], data));
  await expect(page.getByTestId('lane-planning-drop-hint')).toHaveCount(0);
  await expect.poll(async () => (await tickets()).find((ticket) => ticket.ado?.workItemId === 71371)?.stage, { timeout: 60_000 }).toBe('queued');

  // Pop out again brings the same window to the front instead of opening another.
  await page.getByTestId('team-board-backlog').click();
  await page.getByRole('button', { name: 'Pop out' }).click();
  await expect.poll(() => board.app.windows().length).toBe(2);
  await backlogWindow.close();
});

/** Browser-side: what a native dragstart on the element puts on the drag, by type. */
function dragStartScript(testId: string): string {
  return `(() => {
    const transfer = new DataTransfer();
    document.querySelector('[data-testid="${testId}"]').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }));
    return Object.fromEntries(transfer.types.map((type) => [type, transfer.getData(type)]));
  })()`;
}

/** Browser-side: native drag events carrying `data`, dispatched on the element in order. */
function dragEventsScript(testId: string, events: readonly string[], data: Record<string, string>): string {
  return `(() => {
    const transfer = new DataTransfer();
    for (const [type, value] of Object.entries(${JSON.stringify(data)})) transfer.setData(type, value);
    const target = document.querySelector('[data-testid="${testId}"]');
    for (const name of ${JSON.stringify(events)}) target.dispatchEvent(new DragEvent(name, { bubbles: true, cancelable: true, dataTransfer: transfer }));
  })()`;
}
