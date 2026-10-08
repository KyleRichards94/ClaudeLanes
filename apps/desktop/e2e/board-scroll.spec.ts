import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { Result } from '@agent-lanes/contracts';
import { ADO_FIXTURE_PROJECT } from '@agent-lanes/contracts/testing';
import { startFakeAdoServer, type FakeAdoServer } from './support/fake-ado-server';
import { E2E_TICKET_START, e2eTicketRecord, seedTicketRecords } from './support/ticket-records';

/**
 * The board scrolled down to the team board: the header stays pinned at the top. Four agent tickets
 * and the fake organisation's artboard 08 board make the page taller than the 1440 × 960 window.
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
