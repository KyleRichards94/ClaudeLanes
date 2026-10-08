import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { artboard08Items, artboard11Backlog, type FakeWorkItem } from '@agent-lanes/ado-client/testing';
import { startTeamBoardApp, type TeamBoardApp } from './support/team-board-app';

/**
 * AL-241: the team board's drops end to end in the real app, against the fake organisation
 * (artboard 08's board and PRs, artboard 11's backlog) and the `claude` stand-in:
 *
 * 1. Failed #71318 → Planning: assigned, In Progress, agent planning; Undo puts ADO and disk back.
 * 2. Someone else's PR !10598 → Code review: a read-only review worktree, no ADO writes.
 * 3. Your PR !10571 → Implementing: a worktree on its source branch to answer the comments.
 * 4. Two backlog rows → Implementing: one agent each, the second Queued at the agent limit.
 * 5. #71335 moved in ADO since the board loaded: main's recheck refuses the drop, nothing changes.
 * 6. #71273 dropped on Planning with the keyboard alone (Space, arrows, Space), announced.
 */

let board: TeamBoardApp;
let page: Page;

/** The agent behind #71318's first turn asks for plan approval and waits, so the turn is still running when Undo is pressed. */
const PLANNING_AGENT = { turns: [{ match: '#71318', steps: [{ tool: 'set_stage' as const, input: { stage: 'implementing', summary: 'Plan: round each line, then total' } }] }] };

/** Requests the fake team organisation received after `from` that change something (reads are GETs and two POSTed queries). */
function writesSince(from: number): string[] {
  return board.ado
    .teamOrg!.state.requests.slice(from)
    .filter((request) => !request.startsWith('GET ') && !/^POST [^?]*\/_apis\/wit\/(wiql|workitemsbatch)\b/.test(request));
}

function item(id: number): FakeWorkItem {
  const found = board.ado.teamOrg!.state.workItems.items.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`#${id} is not in the fake organisation`);
  return found;
}

function assigneeName(work: FakeWorkItem): string | undefined {
  return typeof work.assignedTo === 'object' ? work.assignedTo.displayName : work.assignedTo;
}

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) throw new Error('not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A pointer drag from the card onto the lane, past dnd-kit's 4 px activation distance. */
async function dragOnto(card: Locator, lane: string): Promise<void> {
  await dismissToasts();
  const from = await center(card);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y - 10, { steps: 3 });
  await expect(page.getByTestId(`lane-${lane}-drop-hint`)).toBeVisible();
  const box = await page.getByTestId(`lane-${lane}`).boundingBox();
  if (!box) throw new Error(`lane ${lane} is not visible`);
  await page.mouse.move(box.x + box.width / 2, box.y + 80, { steps: 8 });
  await expect(page.getByTestId(`lane-${lane}`)).toHaveCSS('border-top-style', 'solid');
  await page.mouse.up();
}

/**
 * The toast stack sits over the board's right-hand columns: earlier launches' toasts are put away
 * first. Info toasts have no Dismiss and close themselves after 5 s.
 */
async function dismissToasts(): Promise<void> {
  const dismiss = page.getByTestId('toast-host').getByRole('button', { name: 'Dismiss' });
  while ((await dismiss.count()) > 0) await dismiss.first().click();
  // A toast under the pointer keeps itself open.
  await page.mouse.move(8, 8);
  await expect(page.locator('[data-testid^="toast-"]:not([data-testid^="toast-host"])')).toHaveCount(0, { timeout: 15_000 });
}

async function stageOf(ticketId: string): Promise<string | undefined> {
  return (await board.tickets()).find((ticket) => ticket.id === ticketId)?.stage;
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const items = artboard08Items();
  const boardIds = new Set(items.map((work) => work.id));
  board = await startTeamBoardApp({
    name: 'drops',
    teamItems: [...items, ...artboard11Backlog().filter((work) => !boardIds.has(work.id))],
    // Three at a time: the review and the comments agent take two, so the second backlog row queues.
    maxConcurrentAgents: 3,
    // The pull requests' and #71273's branches, so their worktrees can be checked out.
    originBranches: ['71240-job-notes-editor', 'users/ty/71298-invoice-matching', '71273-cutover-frmjobcontrol-to'],
    claude: { lead: PLANNING_AGENT },
  });
  page = board.page;
  await expect(page.getByTestId('team-card-71318')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('team-pr-10571')).toBeVisible();
});

test.afterAll(async () => {
  await board?.close();
});

test('1 · Failed #71318 on Planning: assigned and In Progress, agent planning; Undo puts ADO and disk back (T5, T8)', async () => {
  const before = { state: item(71318).state, column: item(71318).boardColumn, assignee: assigneeName(item(71318)) };
  expect(before).toEqual({ state: 'Failed UAT', column: 'Failed', assignee: 'Kyle Richards' });

  await dragOnto(page.getByTestId('team-card-71318'), 'planning');

  await expect(page.getByTestId('lane-planning').getByTestId('card-71318')).toBeVisible({ timeout: 30_000 });
  const toast = page.getByTestId('toast-launch-from-ado:71318');
  await expect(toast).toContainText('Agent started in Planning');
  await expect(toast).toContainText('moved to In Progress');
  expect(item(71318)).toMatchObject({ state: 'Active', boardColumn: 'In Progress' });
  const ticket = (await board.tickets()).find((entry) => entry.id === '71318')!;
  expect(existsSync(ticket.worktreePath)).toBe(true);
  expect(git(board.repo, 'branch', '--list', ticket.branch)).not.toBe('');
  await page.screenshot({ path: test.info().outputPath('team-board-after-drop-1440x960.png') });

  // Undo is a real button, there for 10 s while the first turn waits on the plan.
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(toast).toContainText('Launch undone', { timeout: 30_000 });
  await expect(page.getByTestId('card-71318')).toHaveCount(0);
  expect({ state: item(71318).state, column: item(71318).boardColumn, assignee: assigneeName(item(71318)) }).toEqual(before);
  expect(existsSync(ticket.worktreePath)).toBe(false);
  expect(git(board.repo, 'branch', '--list', ticket.branch)).toBe('');
  expect(await stageOf('71318')).toBeUndefined();
});

test("2 · someone else's PR !10598 on Code review: a read-only review, and nothing written to Azure DevOps (T3)", async () => {
  const from = board.ado.teamOrg!.state.requests.length;
  await dragOnto(page.getByTestId('team-pr-10598'), 'code-review');

  await expect.poll(() => stageOf('pr-10598-review'), { timeout: 30_000 }).toBe('code-review');
  const ticket = (await board.tickets()).find((entry) => entry.id === 'pr-10598-review')!;
  // A detached checkout of the PR's source commit (D694).
  expect(git(ticket.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('HEAD');
  expect(git(ticket.worktreePath, 'rev-parse', 'HEAD')).toBe(git(board.origin, 'rev-parse', 'refs/heads/users/ty/71298-invoice-matching'));
  expect(writesSince(from)).toEqual([]);
});

test('3 · your PR !10571 on Implementing: a worktree on its source branch to answer the 6 comments (T4)', async () => {
  const from = board.ado.teamOrg!.state.requests.length;
  await dragOnto(page.getByTestId('team-pr-10571'), 'implementing');

  await expect.poll(() => stageOf('pr-10571'), { timeout: 30_000 }).toBe('implementing');
  const ticket = (await board.tickets()).find((entry) => entry.id === 'pr-10571')!;
  expect(git(ticket.worktreePath, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('71240-job-notes-editor');
  expect(writesSince(from)).toEqual([]);
});

test('4 · two selected backlog rows on Implementing: one agent each, the second Queued at the limit (TB§5)', async () => {
  await page.getByTestId('team-board-backlog').click();
  await expect(page.getByTestId('backlog-row-71360')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('backlog-row-71360-select').click();
  await page.getByTestId('backlog-row-71362-select').click();
  await dragOnto(page.getByTestId('backlog-row-71360'), 'implementing');

  // The review and the comments agent hold two of the repo's three slots.
  await expect.poll(async () => [await stageOf('71360'), await stageOf('71362')], { timeout: 60_000 }).toEqual(['implementing', 'queued']);
  for (const id of [71360, 71362]) expect({ state: item(id).state, assignee: assigneeName(item(id)) }).toEqual({ state: 'Active', assignee: 'Kyle Richards' });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('backlog-popout')).toHaveCount(0);
});

test('5 · an item moved in Azure DevOps since the board loaded is refused by the recheck, and nothing changes (TB§4)', async () => {
  // #71335 is still in To Do on the board; in ADO someone has moved it to Testing.
  const moved = item(71335);
  moved.boardColumn = 'Testing';
  moved.state = 'Resolved';
  const from = board.ado.teamOrg!.state.requests.length;

  await dragOnto(page.getByTestId('team-card-71335'), 'planning');

  const toast = page.getByTestId('toast-launch-from-ado');
  await expect(toast).toContainText("The drop didn't start an agent", { timeout: 30_000 });
  await expect(toast).toContainText('Moved to Testing — refreshed');
  expect(await stageOf('71335')).toBeUndefined();
  expect(writesSince(from)).toEqual([]);
  // The board is read again and shows the card where ADO has it.
  await expect(page.getByTestId('team-card-71335').getByText('Resolved')).toBeVisible({ timeout: 20_000 });
});

test('6 · #71273 dropped on Planning with the keyboard alone, and announced (TB§7)', async () => {
  const card = page.getByTestId('team-card-71273');
  await card.scrollIntoViewIfNeeded();
  await card.focus();
  await page.keyboard.press('Space');
  // The keyboard sensor listens from the next task (D729).
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[id^="DndLiveRegion"]')).toHaveText('Over Planning: plan it');
  await page.keyboard.press('Space');
  await expect(page.locator('[id^="DndLiveRegion"]')).toHaveText('Dropped #71273 on Planning: plan it');

  // An In Progress item of yours changes nothing in ADO; its agent works on the item's branch.
  await expect.poll(() => stageOf('71273'), { timeout: 30_000 }).toMatch(/planning|queued/);
  const ticket = (await board.tickets()).find((entry) => entry.id === '71273')!;
  expect(ticket.branch).toBe('71273-cutover-frmjobcontrol-to');
});
