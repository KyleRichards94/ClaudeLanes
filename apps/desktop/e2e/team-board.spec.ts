import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { Result } from '@agent-lanes/contracts';
import { ADO_FIXTURE_PROJECT } from '@agent-lanes/contracts/testing';
import { auditTargets, seriousAxeViolations } from './support/accessibility';
import { startFakeAdoServer, type FakeAdoServer } from './support/fake-ado-server';

/**
 * AL-234 in the real app: the team board under the agent lanes, read through `ado:listTeams`,
 * `ado:teamBoard`, `ado:activePrs` and `ado:backlog` from the fake organisation (artboard 08's board,
 * served on 127.0.0.1). The PAT is the fake's, valid nowhere.
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

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ado = await startFakeAdoServer({ teamBoard: true, orgName: 'CompanionSystems' });
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-team-board-'));
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 960));
  await expect(page.getByText('Agent board')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await ado?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('asks for an Azure DevOps connection before one is saved', async () => {
  await expect(page.getByTestId('team-board-not-connected')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Team board', level: 2 })).toBeVisible();
});

test("shows the profile team's board and Active PRs from Azure DevOps (artboard 08)", async () => {
  expect(await invoke('connections:save', { kind: 'ado', orgUrl: ado.orgUrl, pat: ado.pat, defaultProject: ADO_FIXTURE_PROJECT })).toMatchObject({ ok: true });
  expect(await invoke('connections:test', { id: 'ado:companionsystems' })).toMatchObject({ ok: true, data: { status: 'ok' } });

  const board = page.getByTestId('team-board');
  await expect(board.getByTestId('team-board-columns')).toBeVisible({ timeout: 20_000 });
  await expect(board.getByTestId('team-board-org')).toHaveText('Azure DevOps · CompanionSystems');
  await expect(board.getByRole('button', { name: 'Team: OSC Developers · from your ADO profile' })).toBeVisible();
  await expect(board.getByRole('heading', { level: 3 })).toHaveText(['To Do', 'In Progress', 'Code Review', 'Testing', 'Failed', 'Active PRs']);

  // Someone else's item is locked with their name; mine is not.
  await expect(board.getByTestId('team-card-71341-lock')).toHaveText('Assigned to Mia Davies');
  await expect(board.getByTestId('team-card-71273')).toBeVisible();
  await expect(board.getByTestId('team-card-71273-lock')).toHaveCount(0);
  await expect(board.getByTestId('team-pr-10598')).toContainText('!10598');
  await expect(board.getByTestId('team-pr-10598')).toContainText(/\d+ comments?/);
  await expect(board.getByTestId('team-board-backlog')).toContainText(/Backlog \d+/);

  await page.screenshot({ path: test.info().outputPath('team-board-1440x960.png'), fullPage: false });
});

test('the loaded team board has no serious axe violations and 44 px targets', async () => {
  expect(await seriousAxeViolations(page)).toEqual([]);
  expect((await auditTargets(page)).small).toEqual([]);
});

test('the Me filter and the team stay for the session', async () => {
  const board = page.getByTestId('team-board');
  await board.getByRole('radio', { name: 'Me' }).click();
  await expect(board.getByTestId('team-card-71341')).toHaveCount(0);
  await expect(board.getByTestId('team-card-71273')).toBeVisible();

  // Away to a ticket's page and back: the board remounts with the same filter.
  await page.evaluate(() => {
    (globalThis as unknown as { location: { hash: string } }).location.hash = '#/ticket/71273';
  });
  await expect(page.getByTestId('ticket-page')).toBeVisible();
  await page.keyboard.press('Alt+ArrowLeft');
  await expect(page.getByTestId('team-board-columns')).toBeVisible();
  await expect(page.getByTestId('team-board').getByRole('radio', { name: 'Me' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('team-card-71341')).toHaveCount(0);
});
