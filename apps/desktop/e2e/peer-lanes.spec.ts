import { execFileSync } from 'node:child_process';
import { expect, test, type Page } from '@playwright/test';
import { artboard11Backlog } from '@agent-lanes/ado-client/testing';
import { STAGES, type PeerNetworkStatus } from '@agent-lanes/contracts';
import { startFakeAdoServer, type FakeAdoServer } from './support/fake-ado-server';
import type { FakeAgentTurn } from './support/fake-claude-code';
import { startTeamBoardApp, type TeamBoardApp } from './support/team-board-app';

/**
 * AL-297: two Agent Lanes apps on this computer, each listing the other as `localhost:<port>`, with
 * one fake Azure DevOps organisation where #71360 and #71362 sit under Feature #70101 "Job
 * management". A lane in each app joins that room; the fake agents post through `post_to_room`, and
 * the other app's agent gets the post as a `[Peer lanes]` turn.
 */

const ALL_AUTO = Object.fromEntries(STAGES.map((stage) => [stage, 'auto']));
const SAME_FILE = 'src/JobDto.cs';
const BEACON_PORT = 47820;

/** Generic replies to room turns, so each one gets an answer whatever arrives first. */
const noted = (who: string): FakeAgentTurn[] => Array.from({ length: 6 }, () => ({ match: '[Peer lanes]', steps: [{ text: `${who} noted the room` }] }));

const MITCH_AGENT: FakeAgentTurn[] = [
  { match: '#71360', steps: [{ commit: { file: SAME_FILE, content: 'public record JobDto(string Status);\n', message: 'Add JobDto.Status' } }] },
  { match: 'post changed now', steps: [{ tool: 'post_to_room', input: { kind: 'changed', text: 'Added JobDto.Status', files: [SAME_FILE] } }] },
  { match: '(person)', steps: [{ text: 'Mitch got the person' }] },
  ...noted('Mitch'),
];

const KYLE_AGENT: FakeAgentTurn[] = [
  { match: '#71362', steps: [{ commit: { file: SAME_FILE, content: 'public record JobDto(int Id);\n', message: 'Add JobDto.Id' } }] },
  { match: 'changed: "Added JobDto.Status"', steps: [{ text: 'Kyle saw the change to JobDto' }] },
  { match: 'post blocked now', steps: [{ tool: 'post_to_room', input: { kind: 'blocked', text: 'Need the JobStatus enum from #71360' } }] },
  { match: '(person)', steps: [{ text: 'Kyle got the person' }] },
  ...noted('Kyle'),
];

let ado: FakeAdoServer;
let mitch: TeamBoardApp;
let kyle: TeamBoardApp;

async function transcript(app: TeamBoardApp, ticketId: string): Promise<string> {
  const reply = await app.invoke<{ events: unknown[] }>('agent:getTranscript', { ticketId });
  return reply.ok ? JSON.stringify(reply.data.events) : '';
}

async function network(app: TeamBoardApp): Promise<PeerNetworkStatus | null> {
  const reply = await app.invoke<PeerNetworkStatus>('peers:list');
  return reply.ok ? reply.data : null;
}

async function launch(app: TeamBoardApp, id: number, title: string): Promise<void> {
  const launched = await app.invoke('tickets:launch', { repo: app.repo, workItem: { id, title }, description: '', skills: [], model: 'haiku', effort: 'low', gates: ALL_AUTO, worktreeName: null });
  expect(launched).toMatchObject({ ok: true });
  // Launched over IPC, not from the modal, so the board reads the new record on a reload.
  await app.page.reload();
  await expect(app.page.getByTestId(`card-${id}`)).toBeVisible({ timeout: 20_000 });
}

async function openRooms(page: Page): Promise<void> {
  await page.getByTestId('open-rooms').click();
  await expect(page.getByTestId('rooms-panel')).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  ado = await startFakeAdoServer({ teamBoard: true, orgName: 'CompanionSystems', teamItems: artboard11Backlog() });
  // Off the ports a real Agent Lanes on this computer uses (47811, 47810).
  const [mitchPort, kylePort] = [47821, 47822];
  mitch = await startTeamBoardApp({ name: 'peers-mitch', ado, claude: { lead: { turns: MITCH_AGENT } } });
  // The second app skips the ADO token test, so it posts under the Windows user name and the two are told apart.
  kyle = await startTeamBoardApp({ name: 'peers-kyle', ado, testAdo: false, claude: { lead: { turns: KYLE_AGENT } } });
  for (const [app, port, other] of [
    [mitch, mitchPort, kylePort],
    [kyle, kylePort, mitchPort],
  ] as const) {
    expect(await app.invoke('connections:save', { kind: 'peers', port, beaconPort: BEACON_PORT, addresses: [`localhost:${other}`] })).toMatchObject({ ok: true });
  }
  await expect.poll(async () => (await network(mitch))?.peers[0]?.state, { timeout: 20_000 }).toBe('online');
  await expect.poll(async () => (await network(kyle))?.peers[0]?.state, { timeout: 20_000 }).toBe('online');
});

test.afterAll(async () => {
  await mitch?.close();
  await kyle?.close();
  await ado?.close();
});

test('a lane in each app joins the Feature room, and both boards show who is in it and the shared file', async () => {
  test.setTimeout(120_000);
  await launch(mitch, 71360, 'Bulk reassign jobs between technicians');
  await launch(kyle, 71362, 'Job search ignores archived clients filter');
  await expect(mitch.page.getByTestId('peers-pill')).toContainText('Peers · 1 online');
  await expect(kyle.page.getByTestId('peers-pill')).toContainText('Peers · 1 online');
  await expect(mitch.page.getByTestId('card-71360-room')).toContainText('Room · Feature #70101 · with', { timeout: 30_000 });
  await expect(kyle.page.getByTestId('card-71362-room')).toContainText('Room · Feature #70101 · with', { timeout: 30_000 });
  // Touched files go out with the next presence tick (30 s): both lanes changed JobDto.cs.
  await expect(mitch.page.getByTestId('card-71360-overlap')).toContainText('is also in JobDto.cs', { timeout: 60_000 });
  await expect(kyle.page.getByTestId('card-71362-overlap')).toContainText('is also in JobDto.cs', { timeout: 60_000 });
});

test("a changed from one fake agent arrives as a turn in the other app's agent, after the push", async () => {
  test.setTimeout(90_000);
  const ticket = (await mitch.tickets()).find((entry) => entry.id === '71360')!;
  execFileSync('git', ['push', '--quiet', '-u', 'origin', ticket.branch], { cwd: ticket.worktreePath, stdio: 'pipe' });
  expect(await mitch.invoke('agent:send', { ticketId: '71360', text: 'post changed now' })).toMatchObject({ ok: true });
  await expect.poll(() => transcript(kyle, '71362'), { timeout: 30_000 }).toContain('Kyle saw the change to JobDto');
  // The change is a room message, not one that asks for help: no bubble.
  await expect(kyle.page.getByTestId('assist-bubble')).toHaveCount(0);
});

test('a blocked raises the Assist bubble on the other board, and opening the room shows it and clears it', async () => {
  test.setTimeout(90_000);
  expect(await kyle.invoke('agent:send', { ticketId: '71362', text: 'post blocked now' })).toMatchObject({ ok: true });
  await expect(mitch.page.getByTestId('assist-bubble')).toHaveAttribute('aria-label', '1 waiting on you', { timeout: 30_000 });
  await expect(mitch.page.getByTestId('lane-planning-assist')).toBeVisible();
  // The board with the Peers pill, the Assist bubbles and the overlap row, before the panel covers it.
  await mitch.page.screenshot({ path: test.info().outputPath('peer-lanes-board-1440x960.png') });

  await mitch.page.getByTestId('assist-bubble').click();
  await expect(mitch.page.getByTestId('rooms-panel')).toBeVisible();
  await expect(mitch.page.getByTestId('room-heading')).toHaveText('Feature #70101 · Job management');
  const log = mitch.page.getByTestId('room-log-70101');
  await expect(log).toContainText('Added JobDto.Status');
  await expect(log).toContainText('Need the JobStatus enum from #71360');
  await mitch.page.screenshot({ path: test.info().outputPath('peer-lanes-1440x960.png') });
  await mitch.page.keyboard.press('Escape');
  await expect(mitch.page.getByTestId('assist-bubble')).toHaveCount(0, { timeout: 15_000 });

  // The same log on the other app.
  await openRooms(kyle.page);
  await expect(kyle.page.getByTestId('room-log-70101')).toContainText('Added JobDto.Status');
  await expect(kyle.page.getByTestId('room-log-70101')).toContainText('Need the JobStatus enum from #71360');
  await kyle.page.keyboard.press('Escape');
});

test("a person's post from the Room tab reaches the other app's agent with (person)", async () => {
  test.setTimeout(90_000);
  await mitch.page.getByTestId('card-71360').click();
  await mitch.page.getByRole('tab', { name: /Room/ }).click();
  await expect(mitch.page.getByTestId('room-tab')).toBeVisible();
  await mitch.page.getByTestId('room-post-text').fill('Who has the mapper?');
  await mitch.page.getByTestId('room-post').click();
  await expect(mitch.page.getByTestId('room-tab')).toContainText('(person)');
  await expect.poll(() => transcript(kyle, '71362'), { timeout: 30_000 }).toContain('Kyle got the person');
});
