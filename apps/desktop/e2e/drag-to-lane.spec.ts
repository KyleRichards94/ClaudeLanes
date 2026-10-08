import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { RepoSettings, Result } from '@agent-lanes/contracts';
import { ADO_FIXTURE_PROJECT } from '@agent-lanes/contracts/testing';
import { seriousAxeViolations } from './support/accessibility';
import { startFakeAdoServer, type FakeAdoServer } from './support/fake-ado-server';

/**
 * AL-235 in the real app: team board cards dragged onto the agent lanes with the pointer and with the
 * keyboard, and the "Send to lane" menu, against the fake organisation's artboard 08 board. The
 * onsite-companion repo is registered (its origin is the fake's), so PR !10571 is not refused with
 * "Add repo". Nothing is dropped: launching is AL-236's.
 */

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

let ado: FakeAdoServer;
let root: string;
let userDataDir: string;
let app: ElectronApplication | undefined;
let page: Page;

function invoke<T>(channel: string, payload?: unknown): Promise<Result<T>> {
  return page.evaluate(
    ([name, body]) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name as string, body),
    [channel, payload] as const,
  ) as Promise<Result<T>>;
}

const STAGE_LANES = ['queued', 'planning', 'implementing', 'code-review', 'qa', 'create-pr'] as const;

/** dnd-kit's live region, where drags are announced. */
const announcement = () => page.locator('[id^="DndLiveRegion"]');

/**
 * dnd-kit's keyboard sensor starts listening for arrows on the next task after Space (a 0 ms timer).
 * A person never presses that fast; a test can, so it waits one task too (timers run in order).
 */
async function sensorListening(): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
}

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ado = await startFakeAdoServer({ teamBoard: true, orgName: 'CompanionSystems' });
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-drag-to-lane-')));
  userDataDir = join(root, 'profile');
  mkdirSync(userDataDir);

  const repo = join(root, 'onsite-companion');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  git('init', '--quiet', '--initial-branch=main');
  git('-c', 'user.name=Agent Lanes', '-c', 'user.email=e2e@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', 'Initial');
  git('remote', 'add', 'origin', `${ado.orgUrl}/${encodeURIComponent(ADO_FIXTURE_PROJECT)}/_git/onsite-companion`);
  const repoSettings: RepoSettings = {
    path: repo,
    name: 'onsite-companion',
    baseBranch: 'main',
    worktreeRoot: join(root, '.agent-lanes'),
    buildCommand: null,
    runCommand: null,
    maxConcurrentAgents: 4,
  };
  writeFileSync(join(userDataDir, 'settings.json'), JSON.stringify({ version: 2, repos: [repoSettings] }));

  app = await electron.launch({ args: [join(__dirname, '..')], env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir } });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));
  await expect(page.getByText('Agent board')).toBeVisible();

  expect(await invoke('connections:save', { kind: 'ado', orgUrl: ado.orgUrl, pat: ado.pat, defaultProject: ADO_FIXTURE_PROJECT })).toMatchObject({ ok: true });
  expect(await invoke('connections:test', { id: 'ado:companionsystems' })).toMatchObject({ ok: true, data: { status: 'ok' } });
  await expect(page.getByTestId('team-pr-10571')).toBeVisible({ timeout: 20_000 });
});

test.afterAll(async () => {
  await app?.close();
  await ado?.close();
  rmSync(root, { recursive: true, force: true });
});

test('dragging PR !10571 lights Implementing and Code review only (artboard 09)', async () => {
  const card = page.getByTestId('team-pr-10571');
  await card.scrollIntoViewIfNeeded();
  const from = await center(card);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  // Past the 4 px activation distance, then over the Implementing lane.
  await page.mouse.move(from.x + 10, from.y - 10, { steps: 3 });
  await expect(page.getByTestId('drag-status')).toHaveText('Drop !10571 on a highlighted lane');

  await expect(page.getByTestId('lane-implementing-drop-hint')).toContainText('Answer PR comments');
  await expect(page.getByTestId('lane-code-review-drop-hint')).toContainText('Review this PR');
  for (const lane of ['queued', 'planning', 'qa', 'create-pr']) await expect(page.getByTestId(`lane-${lane}-drop-hint`)).toHaveCount(0);
  // Lit lanes have a dashed border; the rest fade.
  await expect(page.getByTestId('lane-code-review')).toHaveCSS('border-top-style', 'dashed');
  await expect(page.getByTestId('lane-planning')).toHaveCSS('opacity', '0.45');

  const implementing = page.getByTestId('lane-implementing');
  await implementing.scrollIntoViewIfNeeded();
  const over = await center(implementing);
  await page.mouse.move(over.x, over.y, { steps: 8 });
  await expect(implementing).toHaveCSS('border-top-style', 'solid');
  await expect(announcement()).toHaveText('Over Implementing: answer 6 comments');
  await page.screenshot({ path: test.info().outputPath('drag-to-lane-1440x960.png'), fullPage: false });

  // Escape cancels: nothing is launched and the lanes go back to normal.
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByTestId('lane-implementing-drop-hint')).toHaveCount(0);
  await expect(page.getByTestId('drag-status')).toHaveCount(0);
  await expect(page.getByTestId('board-legend')).toBeVisible();
});

test('the keyboard picks a card up with Space, moves between the lanes that take it with the arrows, and announces each', async () => {
  const card = page.getByTestId('team-pr-10571');
  await card.focus();
  await page.keyboard.press('Space');
  await sensorListening();
  await expect(announcement()).toContainText('Picked up !10571. Implementing and Code review take it.');
  await expect(page.getByTestId('lane-code-review-drop-hint')).toBeVisible();
  await expect(page.getByTestId('lane-implementing-drop-hint')).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await expect(announcement()).toHaveText('Over Implementing: answer 6 comments');
  await page.keyboard.press('ArrowRight');
  await expect(announcement()).toHaveText('Over Code review: start agentic review');
  await page.keyboard.press('ArrowLeft');
  await expect(announcement()).toHaveText('Over Implementing: answer 6 comments');

  await page.keyboard.press('Escape');
  await expect(announcement()).toHaveText('Cancelled. !10571 is back in its column.');
  for (const lane of STAGE_LANES) await expect(page.getByTestId(`lane-${lane}-drop-hint`)).toHaveCount(0);
});

test('Enter opens "Send to lane" with only the lanes that take the card; Escape closes it', async () => {
  const card = page.getByTestId('team-pr-10571');
  await card.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Send !10571 to a lane' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveCount(2);
  await expect(page.getByTestId('send-to-lane-implementing')).toBeFocused();
  await expect(page.getByTestId('send-to-lane-code-review')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('send-to-lane-code-review')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(card).toBeFocused();
});

test("someone else's item is not a drag handle, and the board has no serious axe violations", async () => {
  await expect(page.getByTestId('team-card-71341')).toHaveAttribute('role', 'listitem');
  await expect(page.getByTestId('team-card-71341')).not.toHaveAttribute('tabindex', '0');
  await expect(page.getByTestId('team-card-71273')).toHaveAttribute('aria-roledescription', 'draggable card');
  expect(await seriousAxeViolations(page)).toEqual([]);
});
