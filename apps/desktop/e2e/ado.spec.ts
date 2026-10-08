import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { ADO_FIXTURE_PAT } from '@agent-lanes/ado-client/testing';
import {
  formatPullRequestActivity,
  type ConnectionSummary,
  type ConnectionTestResult,
  type CreatedPullRequest,
  type PullRequestSnapshot,
  type Result,
  type SprintList,
  type WorkItem,
  type WorkItemComment,
} from '@agent-lanes/contracts';
import {
  ADO_FIXTURE_IDENTITY,
  ADO_FIXTURE_ORG_ID,
  ADO_FIXTURE_PROJECT,
  ADO_FIXTURE_REPOSITORY,
  ADO_FIXTURE_SPRINT_42_PATH,
  ADO_FIXTURE_TEAM,
  ADO_FIXTURE_TEAM_ID,
  adoFixture,
  type AdoFixture,
} from '@agent-lanes/contracts/testing';
import { startFakeAdoServer, type FakeAdoServer } from './support/fake-ado-server';

/**
 * AL-065 against the real app: every `ado:*` channel from the renderer, through the preload and the
 * main process's AdoService, to the shared fake Azure DevOps organisation served on 127.0.0.1 (the
 * same MSW handlers and fixture the unit tests use). The PAT is the fixture's, valid nowhere.
 */

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

let ado: FakeAdoServer;
let fixture: AdoFixture;
let userDataDir: string;
let app: ElectronApplication | undefined;
let page: Page;
const replies: unknown[] = [];

async function invoke<T>(channel: string, payload?: unknown): Promise<Result<T>> {
  const reply = await page.evaluate(
    ([name, body]) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name, body),
    [channel, payload] as const,
  );
  replies.push({ channel, reply });
  return reply as Result<T>;
}

async function data<T>(channel: string, payload?: unknown): Promise<T> {
  const result = await invoke<T>(channel, payload);
  if (!result.ok) throw new Error(`${channel} failed: ${result.code} ${result.message}`);
  return result.data;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  // Like the on-prem Azure DevOps Server: the project-level sprints route is a 404, only the team's works.
  ado = await startFakeAdoServer({ projectIterations: false });
  fixture = adoFixture(ado.orgUrl);
  userDataDir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-ado-'));
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: { ...process.env, AGENT_LANES_USER_DATA_DIR: userDataDir },
  });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
});

test.afterAll(async () => {
  await app?.close();
  await ado?.close();
  rmSync(userDataDir, { recursive: true, force: true });
});

test('before an organisation is connected, every ado channel answers ADO_UNAUTHORIZED', async () => {
  expect(await invoke('ado:listSprints', {})).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED', details: { reason: 'not-connected' } });
  expect(await invoke('ado:getWorkItem', { id: 71273 })).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });
  expect(ado.org.state.requests).toEqual([]);
});

test('every ado channel reads the fake organisation through the saved connection', async () => {
  const saved = await data<ConnectionSummary>('connections:save', { kind: 'ado', orgUrl: ado.orgUrl, pat: ADO_FIXTURE_PAT, defaultProject: ADO_FIXTURE_PROJECT });
  expect(saved).toMatchObject({ id: ADO_FIXTURE_ORG_ID, kind: 'ado', orgUrl: ado.orgUrl, defaultProject: ADO_FIXTURE_PROJECT });
  expect(await data<ConnectionTestResult>('connections:test', { id: ADO_FIXTURE_ORG_ID })).toMatchObject({ status: 'ok', identity: ADO_FIXTURE_IDENTITY });

  expect(await data<SprintList>('ado:listSprints', {})).toEqual(fixture.sprints);
  expect(await data<WorkItem[]>('ado:listWorkItems', { iterationPath: ADO_FIXTURE_SPRINT_42_PATH })).toEqual(fixture.workItems.slice(0, 4));
  expect(await data<WorkItem[]>('ado:searchWorkItems', { query: 'frmJobControl' })).toEqual([fixture.workItems[0]]);
  expect(await data<WorkItem[]>('ado:searchWorkItems', { org: ADO_FIXTURE_ORG_ID, query: '71341' })).toEqual([fixture.workItems[3]]);
  expect(await data<WorkItem>('ado:getWorkItem', { id: 71273 })).toEqual(fixture.workItems[0]);
  expect(await data<WorkItemComment[]>('ado:getComments', { project: ADO_FIXTURE_PROJECT, workItemId: 71273 })).toEqual(fixture.comments[71273]);

  const prRef = { project: ADO_FIXTURE_PROJECT, repository: ADO_FIXTURE_REPOSITORY.name, pullRequestId: 10612 };
  const snapshot = await data<PullRequestSnapshot>('ado:getPullRequest', prRef);
  expect(snapshot).toEqual(fixture.pullRequests[0]);
  expect(formatPullRequestActivity(snapshot.pullRequest, snapshot.checks)).toBe('PR !10612 · 3 / 4 checks');

  const created = await data<CreatedPullRequest>('ado:createPullRequest', {
    project: ADO_FIXTURE_PROJECT,
    repository: ADO_FIXTURE_REPOSITORY.name,
    sourceBranch: '71330-asset-register-paging',
    targetBranch: 'main',
    title: 'Asset register paging slow above 5k rows',
    workItemIds: [71330],
  });
  expect(created).toMatchObject({ created: true, pullRequest: { id: 10613, workItemIds: [71330], webUrl: `${ado.orgUrl}/OnSite%20Companion/_git/onsite-companion/pullrequest/10613` } });
  expect(ado.org.state.pullRequests.map((entry) => entry.pullRequest.id)).toEqual([10612, 10613]);

  // Every request reached the fake with the PAT, and the fake answered all of them.
  expect(ado.org.state.requests.length).toBeGreaterThan(10);
  expect(ado.org.state.requests.every((request) => request.authorized)).toBe(true);
  expect(ado.org.state.unhandled).toEqual([]);
});

test('the board reads sprints for the user’s team, with a Team menu and a grouped Sprint menu', async () => {
  expect(await data('ado:listTeams', {})).toEqual({ teams: [{ id: ADO_FIXTURE_TEAM_ID, name: ADO_FIXTURE_TEAM }], defaultTeamId: ADO_FIXTURE_TEAM_ID });

  // The connection was saved over IPC, so reload to let the board read it.
  await page.reload();
  await expect(page.getByTestId('board-team')).toHaveText(ADO_FIXTURE_TEAM);
  await expect(page.getByTestId('board-sprint')).toHaveText('42');
  await expect(page.getByTestId('board-subheader')).toContainText('Sprint 42');

  await page.getByRole('button', { name: 'Sprint: 42' }).click();
  const menu = page.getByRole('menu', { name: 'Sprint' });
  await expect(menu.getByRole('group')).toHaveCount(3);
  await expect(menu.getByRole('group', { name: 'Past' }).getByRole('menuitem')).toHaveText([/Sprint 41/, /Sprint 40/]);
  await menu.getByRole('group', { name: 'Upcoming' }).getByRole('menuitem', { name: 'Sprint 43' }).click();
  await expect(page.getByTestId('board-sprint')).toHaveText('43');

  // Every sprint read went to the team route; none to the project-level one the server refuses.
  const paths = ado.org.state.requests.map((request) => decodeURIComponent(request.path.split('?')[0] ?? ''));
  expect(paths.some((path) => path.endsWith(`/${ADO_FIXTURE_PROJECT}/_apis/work/teamsettings/iterations`))).toBe(false);
  expect(paths.some((path) => path.endsWith(`/${ADO_FIXTURE_PROJECT}/${ADO_FIXTURE_TEAM_ID}/_apis/work/teamsettings/iterations`))).toBe(true);
  // The team board under the lanes (AL-234) also reads its team, which only team-board.spec's fake serves.
  expect(ado.org.state.unhandled.filter((request) => !/\/_apis\/projects\/[^/]+\/teams\/[^/?]+\?/.test(request))).toEqual([]);
});

test('bad requests and ADO failures come back as typed results, never with the token', async () => {
  expect(await invoke('ado:listSprints', { org: 'claude' })).toMatchObject({ ok: false, code: 'VALIDATION' });
  expect(await invoke('ado:getWorkItem', { id: 71273, pat: ADO_FIXTURE_PAT })).toMatchObject({ ok: false, code: 'VALIDATION' });
  expect(await invoke('ado:getWorkItem', { org: 'ado:fabrikam', id: 71273 })).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED', details: { reason: 'not-connected' } });
  expect(await invoke('ado:getWorkItem', { id: 99999 })).toMatchObject({ ok: false, code: 'INTERNAL' });
  expect(await invoke('ado:listSprints', { project: 'Other Project' })).toMatchObject({ ok: false });

  // A replaced token that ADO refuses: its 401 crosses IPC as ADO_UNAUTHORIZED.
  const wrongPat = 'fakepatAL065e2ewrong000only1111never2222real3333zzE2';
  await data<ConnectionSummary>('connections:replace', { id: ADO_FIXTURE_ORG_ID, draft: { kind: 'ado', orgUrl: ado.orgUrl, pat: wrongPat } });
  expect(await invoke('ado:listSprints', {})).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });
  expect(ado.org.state.requests.at(-1)).toMatchObject({ authorized: false });

  const sent = JSON.stringify(replies);
  for (const token of [ADO_FIXTURE_PAT, wrongPat]) {
    expect(sent).not.toContain(token);
    expect(sent).not.toContain(Buffer.from(`:${token}`).toString('base64'));
  }
});
