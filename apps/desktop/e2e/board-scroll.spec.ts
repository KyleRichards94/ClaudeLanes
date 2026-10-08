import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import type { Result } from '@agent-lanes/contracts';
import { ADO_FIXTURE_PROJECT } from '@agent-lanes/contracts/testing';
import { auditTargets } from './support/accessibility';
import { startFakeAdoServer, type FakeAdoServer } from './support/fake-ado-server';
import { E2E_TICKET_START, e2eTicketRecord, seedTicketRecords } from './support/ticket-records';

/**
 * The board scrolled down to the team board: the header stays pinned at the top, and the agent lanes
 * fold into a strip under it that takes drops and expands back. Four agent tickets and the fake
 * organisation's artboard 08 board make the page taller than the 1440 × 960 window.
 */

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

let ado: FakeAdoServer;
let userDataDir: string;
let app: ElectronApplication | undefined;
let page: Page;

function invoke<T>(channel: string, payload?: unknown): Promise<Result<T>> {
  return page.evaluate(
    ([name, body]) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name as string, body),
    [channel, payload] as const,
  ) as Promise<Result<T>>;
}

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

const TICKETS = [
  { id: '71330', stage: 'queued' },
  { id: '71322', stage: 'planning' },
  { id: '71273', stage: 'implementing' },
  { id: '71288', stage: 'implementing' },
] as const;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ado = await startFakeAdoServer({ teamBoard: true, orgName: 'CompanionSystems' });
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-board-scroll-'));
  seedTicketRecords(
    userDataDir,
    TICKETS.map(({ id, stage }, index) =>
      e2eTicketRecord({
        id,
        title: `Ticket ${id}`,
        ado: { orgUrl: 'https://dev.azure.com/contoso', project: 'OnSite Companion', workItemId: Number(id) },
        branch: `${id}-work`,
        worktreePath: `C:\\src\\.agent-lanes\\${id}`,
        stage,
        stageHistory: [{ stage, at: E2E_TICKET_START + index }],
        sessionId: null,
      }),
    ),
  );
  app = await electron.launch({ args: [join(__dirname, '..')], env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir } });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));
  await expect(page.getByText('Agent board')).toBeVisible();
  for (const { id } of TICKETS) await expect(page.getByTestId(`card-${id}`)).toBeVisible();

  expect(await invoke('connections:save', { kind: 'ado', orgUrl: ado.orgUrl, pat: ado.pat, defaultProject: ADO_FIXTURE_PROJECT })).toMatchObject({ ok: true });
  expect(await invoke('connections:test', { id: 'ado:companionsystems' })).toMatchObject({ ok: true, data: { status: 'ok' } });
  await expect(page.getByTestId('team-pr-10571')).toBeVisible({ timeout: 20_000 });
});

test.afterAll(async () => {
  await app?.close();
  await ado?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('the header stays pinned at the top while the page scrolls down to the team board', async () => {
  const header = page.getByTestId('board-header');
  const before = await header.boundingBox();
  if (!before) throw new Error('no header');

  await page.getByTestId('team-pr-10571').scrollIntoViewIfNeeded();
  // The lanes have scrolled away; the header has not.
  await expect.poll(async () => (await page.getByTestId('lane-queued').boundingBox())?.y ?? 0).toBeLessThan(before.y);
  const after = await header.boundingBox();
  expect(after?.y).toBeGreaterThanOrEqual(0);
  expect(after?.y).toBeLessThanOrEqual(before.y);
  await expect(header).toBeInViewport();
  // Still usable while pinned.
  await expect(page.getByTestId('board-count-running')).toBeInViewport();
  await page.screenshot({ path: test.info().outputPath('board-scrolled-1440x960.png'), fullPage: false });
});

test('past the lanes, the agent board folds into a strip under the header with each lane, its count and its cards', async () => {
  // To the bottom (RN-web's ScrollView replaces the node's scrollTo with its own, so set scrollTop).
  await page.getByTestId('board-scroll').evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  const strip = page.getByTestId('agent-board-strip');
  await expect(strip).toBeVisible();
  await expect(strip).toBeInViewport();
  const header = await page.getByTestId('board-header').boundingBox();
  const box = await strip.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(header!.y + header!.height);

  const implementing = page.getByTestId('strip-lane-implementing');
  await expect(implementing.getByRole('button', { name: 'Implementing, 2 tickets. Show the agent board' })).toBeVisible();
  await expect(page.getByTestId('strip-chip-71273')).toHaveText('#71273');
  await expect(page.getByTestId('strip-chip-71288')).toHaveText('#71288');
  await expect(page.getByTestId('strip-lane-queued').getByRole('button', { name: /^Queued, 1 ticket/ })).toBeVisible();
  // Every target in the strip is at least 44 px.
  expect((await auditTargets(page)).small).toEqual([]);
  await page.screenshot({ path: test.info().outputPath('board-strip-1440x960.png'), fullPage: false });
});

test('Enter on a strip cell scrolls back up to the full agent board, and the strip goes', async () => {
  const head = page.getByTestId('strip-lane-implementing-head');
  await head.focus();
  await expect(head).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => page.getByTestId('board-scroll').evaluate((node) => node.scrollTop)).toBe(0);
  await expect(page.getByTestId('agent-board-strip')).toBeHidden();
  await expect(page.getByTestId('lane-implementing')).toBeInViewport();
});

test('a team board card dragged onto a strip cell lights that lane, as on the lanes, without scrolling up', async () => {
  await page.getByTestId('board-scroll').evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect(page.getByTestId('agent-board-strip')).toBeVisible();
  const card = page.getByTestId('team-card-71318');
  const from = await center(card);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y - 10, { steps: 3 });
  await expect(page.getByTestId('drag-status')).toBeVisible();

  const planning = page.getByTestId('strip-lane-planning');
  await expect(planning).toHaveCSS('border-top-style', 'dashed');
  const over = await center(planning);
  await page.mouse.move(over.x, over.y, { steps: 8 });
  await expect(planning).toHaveCSS('border-top-style', 'solid');
  await expect(page.locator('[id^="DndLiveRegion"]')).toHaveText(/^Over Planning/);
  // The page did not scroll under the pointer: the card is where it was.
  const now = (await card.boundingBox())!;
  expect(Math.abs(now.y + now.height / 2 - from.y)).toBeLessThan(2);
  await expect(page.getByTestId('agent-board-strip')).toBeVisible();

  // Escape: nothing is launched.
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByTestId('drag-status')).toHaveCount(0);
});
