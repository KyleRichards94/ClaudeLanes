import { formatPullRequestActivity, summarizeChecks } from '@agent-lanes/contracts';
import {
  ADO_FIXTURE_IDENTITY,
  ADO_FIXTURE_PROJECT,
  ADO_FIXTURE_PROJECT_ID,
  ADO_FIXTURE_PULL_REQUEST_ID,
  ADO_FIXTURE_REPOSITORY,
  ADO_FIXTURE_SPRINT_42_PATH,
  ADO_FIXTURE_TEAM,
  ADO_FIXTURE_TEAM_ID,
  adoFixture,
} from '@agent-lanes/contracts/testing';
import { setupServer } from 'msw/node';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAdoClient, type AdoClient } from './client';
import { testAdoConnection } from './connection-test';
import { createPullRequest, getPullRequestSnapshot } from './pull-requests';
import { listSprints, listTeams } from './sprints';
import { listMyTeams } from './team-board';
import { ADO_FIXTURE_PAT, createFakeAdoOrg, type FakeAdoOrg } from './testing';
import { getWorkItem, getWorkItems, listSprintWorkItems, searchWorkItems } from './work-items';
import { addWorkItemComment, listWorkItemComments, setWorkItemState } from './write-back';

/**
 * AL-065: the shared fake organisation answers every call the ado-client makes, and what the client
 * reads back from it is exactly the DTO fixture in `@agent-lanes/contracts/testing`.
 */

function clientOf(org: FakeAdoOrg, pat = org.pat): AdoClient {
  const created = createAdoClient({ orgUrl: org.orgUrl, pat, fetch: org.fetch, sleep: async () => undefined });
  if (!created.ok) throw new Error(created.message);
  return created.data;
}

function setup(orgUrl?: string) {
  const org = createFakeAdoOrg(orgUrl === undefined ? {} : { orgUrl });
  return { org, client: clientOf(org), fixture: adoFixture(org.orgUrl) };
}

const PR_REF = { project: ADO_FIXTURE_PROJECT, repository: ADO_FIXTURE_REPOSITORY.name, pullRequestId: ADO_FIXTURE_PULL_REQUEST_ID };

describe('createFakeAdoOrg: reads give back the fixture', () => {
  it('sprints, for the named team and the default team, with Sprint 42 current', async () => {
    const { org, client, fixture } = setup();
    expect(await listSprints(client, { project: ADO_FIXTURE_PROJECT, team: ADO_FIXTURE_TEAM })).toEqual({ ok: true, data: fixture.sprints });
    expect(await listSprints(client, { project: ADO_FIXTURE_PROJECT })).toEqual({ ok: true, data: fixture.sprints });
    expect(await listTeams(client, ADO_FIXTURE_PROJECT)).toMatchObject({ ok: true, data: [{ name: ADO_FIXTURE_TEAM }] });
    expect(org.state.unhandled).toEqual([]);
  });

  it('as an on-prem server: the project-level sprints route is a 404, the team route and listMyTeams work', async () => {
    const org = createFakeAdoOrg({ projectIterations: false });
    const client = clientOf(org);
    const fixture = adoFixture(org.orgUrl);
    expect(await listSprints(client, { project: ADO_FIXTURE_PROJECT })).toMatchObject({ ok: false, details: { status: 404 } });
    expect(await listSprints(client, { project: ADO_FIXTURE_PROJECT, team: ADO_FIXTURE_TEAM })).toEqual({ ok: true, data: fixture.sprints });
    expect(await listMyTeams(client, ADO_FIXTURE_PROJECT)).toEqual({
      ok: true,
      data: { teams: [{ id: ADO_FIXTURE_TEAM_ID, name: ADO_FIXTURE_TEAM }], defaultTeamId: ADO_FIXTURE_TEAM_ID },
    });
    expect(org.state.unhandled).toEqual([]);
  });

  it("Sprint 42's work items: the four artboard items and not Sprint 43's", async () => {
    const { org, client, fixture } = setup();
    const result = await listSprintWorkItems(client, { project: ADO_FIXTURE_PROJECT, iterationPath: ADO_FIXTURE_SPRINT_42_PATH });
    expect(result).toEqual({ ok: true, data: fixture.workItems.slice(0, 4) });
    expect(org.state.unhandled).toEqual([]);
  });

  it('search by id or title, and reads by id', async () => {
    const { client, fixture } = setup();
    const [story] = fixture.workItems;
    expect(await searchWorkItems(client, { project: ADO_FIXTURE_PROJECT, query: '71273' })).toEqual({ ok: true, data: [story] });
    expect(await searchWorkItems(client, { project: ADO_FIXTURE_PROJECT, query: 'frmJobControl' })).toEqual({ ok: true, data: [story] });
    expect(await searchWorkItems(client, { project: ADO_FIXTURE_PROJECT, query: 'nothing like this' })).toEqual({ ok: true, data: [] });
    expect(await getWorkItem(client, { id: 71273 })).toEqual({ ok: true, data: story });
    expect(await getWorkItems(client, { ids: [71341, 71400] })).toEqual({ ok: true, data: [fixture.workItems[3], fixture.workItems[4]] });
    expect(await getWorkItem(client, { id: 99999 })).toMatchObject({ ok: false, code: 'INTERNAL', details: { status: 404 } });
  });

  it("#71273's discussion", async () => {
    const { client, fixture } = setup();
    expect(await listWorkItemComments(client, { project: ADO_FIXTURE_PROJECT, workItemId: 71273 })).toEqual({ ok: true, data: fixture.comments[71273] });
    expect(await listWorkItemComments(client, { project: ADO_FIXTURE_PROJECT, workItemId: 71330 })).toEqual({ ok: true, data: [] });
  });

  it('PR !10612 with its checks: "PR !10612 · 3 / 4 checks"', async () => {
    const { client, fixture } = setup();
    const snapshot = await getPullRequestSnapshot(client, PR_REF);
    expect(snapshot).toEqual({ ok: true, data: fixture.pullRequests[0] });
    // By GUIDs, as `pullRequestRef` keeps it.
    expect(await getPullRequestSnapshot(client, { project: ADO_FIXTURE_PROJECT_ID, repository: ADO_FIXTURE_REPOSITORY.id, pullRequestId: 10612 })).toEqual(snapshot);
    expect(snapshot.ok && formatPullRequestActivity(snapshot.data.pullRequest, snapshot.data.checks)).toBe('PR !10612 · 3 / 4 checks');
  });

  it('passes the connection test: identity, projects and every read probe granted', async () => {
    const { org, client } = setup();
    const tested = await testAdoConnection(client, { defaultProject: ADO_FIXTURE_PROJECT });
    expect(tested).toMatchObject({ ok: true, data: { identity: { displayName: ADO_FIXTURE_IDENTITY }, projects: [ADO_FIXTURE_PROJECT], missingScopes: [] } });
    expect(org.state.unhandled).toEqual([]);
  });

  it('works the same at a loopback organisation URL (the e2e server)', async () => {
    const { client, fixture } = setup('http://127.0.0.1:4321/contoso');
    expect(await getWorkItem(client, { id: 71273 })).toEqual({ ok: true, data: fixture.workItems[0] });
    expect(await getPullRequestSnapshot(client, PR_REF)).toEqual({ ok: true, data: fixture.pullRequests[0] });
  });
});

describe('createFakeAdoOrg: writes land in its state', () => {
  it('a posted comment is read back with the "Agent Lanes ·" prefix', async () => {
    const { client } = setup();
    const posted = await addWorkItemComment(client, { project: ADO_FIXTURE_PROJECT, workItemId: 71330 }, 'Implementing — plan approved');
    expect(posted).toMatchObject({ ok: true, data: { id: 1, text: 'Agent Lanes · Implementing — plan approved', author: ADO_FIXTURE_IDENTITY, fromAgentLanes: true } });
    expect(await listWorkItemComments(client, { project: ADO_FIXTURE_PROJECT, workItemId: 71330 })).toEqual({ ok: true, data: [posted.ok && posted.data] });
  });

  it('a state change moves the work item, and its category follows', async () => {
    const { client } = setup();
    const ref = { project: ADO_FIXTURE_PROJECT, workItemId: 71273 };
    expect(await setWorkItemState(client, ref, 'resolved', { reason: 'QA passed' })).toEqual({
      ok: true,
      data: { outcome: 'changed', workItemId: 71273, state: 'Resolved', previousState: 'Active', rev: 2 },
    });
    expect(await setWorkItemState(client, ref, 'Resolved')).toMatchObject({ ok: true, data: { outcome: 'unchanged' } });
    expect(await getWorkItem(client, { id: 71273 })).toMatchObject({ ok: true, data: { state: 'Resolved', stateCategory: 'resolved' } });
    // The reason shows in the discussion, as ADO shows a history entry.
    const comments = await listWorkItemComments(client, ref);
    expect(comments.ok && comments.data.at(-1)).toMatchObject({ text: 'Agent Lanes · QA passed', fromAgentLanes: true });
    expect(await setWorkItemState(client, ref, 'Shipped')).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('a new pull request is created and linked, and creating it again reuses it', async () => {
    const { org, client } = setup();
    const input = {
      project: ADO_FIXTURE_PROJECT,
      repository: ADO_FIXTURE_REPOSITORY.name,
      sourceBranch: '71330-asset-register-paging',
      targetBranch: 'main',
      title: 'Asset register paging',
      workItemIds: [71330],
    };
    const created = await createPullRequest(client, input);
    expect(created).toMatchObject({ ok: true, data: { created: true, pullRequest: { id: 10613, status: 'active', workItemIds: [71330] } } });
    expect(await createPullRequest(client, input)).toMatchObject({ ok: true, data: { created: false, pullRequest: { id: 10613 } } });

    const snapshot = await getPullRequestSnapshot(client, { ...PR_REF, pullRequestId: 10613 });
    expect(snapshot.ok && formatPullRequestActivity(snapshot.data.pullRequest, snapshot.data.checks)).toBe('PR !10613 · 0 / 2 checks');

    // A check a test sets on the fake comes back through the client.
    const pullRequest = org.state.pullRequests.find((entry) => entry.pullRequest.id === 10613)!;
    pullRequest.checks = summarizeChecks([{ ...pullRequest.checks.checks[0]!, state: 'failed', detail: 'CS0246: JobControlGrid not found' }, pullRequest.checks.checks[1]!]);
    expect(await getPullRequestSnapshot(client, { ...PR_REF, pullRequestId: 10613 })).toMatchObject({
      ok: true,
      data: { checks: { passed: 0, total: 2, failing: [{ name: 'OnSite CI', detail: 'CS0246: JobControlGrid not found' }] } },
    });
  });

  it('links a work item ADO left off a new pull request', async () => {
    const { org, client } = setup();
    const unlinked = { ...org.state.pullRequests[0]!, pullRequest: { ...org.state.pullRequests[0]!.pullRequest, workItemIds: [] } };
    org.state.pullRequests[0] = unlinked;
    const result = await createPullRequest(client, {
      project: ADO_FIXTURE_PROJECT,
      repository: ADO_FIXTURE_REPOSITORY.name,
      sourceBranch: unlinked.pullRequest.sourceBranch,
      targetBranch: 'main',
      title: 'Cutover frmJobControl to Blazor',
      workItemIds: [71273],
    });
    expect(result).toMatchObject({ ok: true, data: { created: false, pullRequest: { id: 10612, workItemIds: [71273] } } });
    expect(org.state.pullRequests[0]!.pullRequest.workItemIds).toEqual([71273]);
  });
});

describe('createFakeAdoOrg: failures look like Azure DevOps', () => {
  it('refuses any other PAT with a 401, which the client maps to ADO_UNAUTHORIZED', async () => {
    const org = createFakeAdoOrg();
    const client = clientOf(org, 'fakepatWRONG0000000000000000000000000000000000000000');
    expect(await getWorkItem(client, { id: 71273 })).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });
    expect(org.state.requests).toEqual([expect.objectContaining({ method: 'GET', authorized: false })]);
    expect(org.pat).toBe(ADO_FIXTURE_PAT);
  });

  it('answers unknown projects, repositories and pull requests with 404s', async () => {
    const { client } = setup();
    expect(await listSprints(client, { project: 'Other Project' })).toMatchObject({ ok: false, details: { status: 404 } });
    expect(await getPullRequestSnapshot(client, { ...PR_REF, repository: 'other-repo' })).toMatchObject({ ok: false, details: { status: 404 } });
    expect(await getPullRequestSnapshot(client, { ...PR_REF, pullRequestId: 1 })).toMatchObject({ ok: false, details: { status: 404 } });
  });

  it('records a request it has no handler for and answers 501', async () => {
    const { org, client } = setup();
    expect(await client.get('/_apis/build/builds', (await import('zod')).z.unknown())).toMatchObject({ ok: false, details: { status: 501 } });
    expect(org.state.unhandled).toEqual([`GET ${org.orgUrl}/_apis/build/builds?api-version=7.1`]);
  });
});

describe('createFakeAdoOrg: as MSW handlers on a server', () => {
  const org = createFakeAdoOrg();
  const server = setupServer(...org.handlers);
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterAll(() => server.close());

  it('serves the same data to a client using the global fetch', async () => {
    const created = createAdoClient({ orgUrl: org.orgUrl, pat: ADO_FIXTURE_PAT });
    if (!created.ok) throw new Error(created.message);
    const fixture = adoFixture();
    expect(await listSprintWorkItems(created.data, { project: ADO_FIXTURE_PROJECT, iterationPath: ADO_FIXTURE_SPRINT_42_PATH })).toEqual({
      ok: true,
      data: fixture.workItems.slice(0, 4),
    });
    expect(org.state.requests.every((request) => request.authorized)).toBe(true);
  });
});
