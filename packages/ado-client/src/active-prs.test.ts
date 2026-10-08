import { describe, expect, it } from 'vitest';
import { isUnresolvedThread, listActivePullRequests } from './active-prs';
import { createAdoClient } from './client';
import { createFakeTeamOrg, FAKE_TEAM_PROJECT, FAKE_TEAM_REPOSITORY, OSC_DEVELOPERS, PEOPLE, RELEASE_TRAIN, type FakeTeamOrgOptions } from './testing/fake-team';

function setup(options: FakeTeamOrgOptions = {}) {
  const org = createFakeTeamOrg(options);
  const created = createAdoClient({ orgUrl: org.orgUrl, pat: org.pat, fetch: org.fetch, sleep: async () => undefined });
  if (!created.ok) throw new Error(created.message);
  return { org, client: created.data };
}

const registered = (repository: { name: string }) => repository.name === FAKE_TEAM_REPOSITORY.name;

describe('listActivePullRequests (AL-232)', () => {
  it("lists the team's open PRs, newest first, with author, reviewers, source branch, repository and unresolved threads", async () => {
    const { client } = setup();
    const listed = await listActivePullRequests(client, { project: FAKE_TEAM_PROJECT, isRegistered: registered });
    if (!listed.ok) throw new Error(listed.message);

    expect(listed.data.team).toEqual(OSC_DEVELOPERS);
    expect(listed.data.pullRequests.map((pr) => [pr.id, pr.author.initials, pr.unresolvedThreads, pr.repository.name, pr.repoRegistered])).toEqual([
      [10598, 'TY', 4, 'onsite-companion', true],
      [10590, 'RJ', 0, 'osc-mobile', false],
      [10571, 'KR', 6, 'onsite-companion', true],
    ]);
    expect(listed.data.pullRequests.find((pr) => pr.id === 10571)).toEqual({
      id: 10571,
      title: 'Job notes rich text editor',
      isDraft: false,
      author: { id: PEOPLE.KR.id, displayName: 'Kyle Richards', uniqueName: 'kyle.richards@example.com', initials: 'KR' },
      reviewers: [{ id: PEOPLE.TY.id, displayName: 'Tom Young', uniqueName: 'tom.young@example.com', initials: 'TY', vote: -5, isRequired: true, isContainer: false }],
      sourceBranch: '71240-job-notes-editor',
      targetBranch: 'main',
      repository: { id: FAKE_TEAM_REPOSITORY.id, name: 'onsite-companion', projectId: '6ce954b1-ce1f-45d1-b94d-e6bf2464ba2c', projectName: 'OnSite Companion' },
      createdAt: '2026-10-06T09:15:42.123Z',
      unresolvedThreads: 6,
      repoRegistered: true,
      webUrl: 'https://dev.azure.com/CompanionSystems/OnSite%20Companion/_git/onsite-companion/pullrequest/10571',
    });
  });

  it('thread counts ignore resolved, closed, deleted and system threads', async () => {
    const { client, org } = setup();
    const pr = org.state.pullRequests.find((candidate) => candidate.pullRequestId === 10598)!;
    // 4 active text threads among 12: fixed, won't fix, closed, by design, deleted, system-only and emptied ones don't count.
    expect(pr.threads).toHaveLength(12);
    const listed = await listActivePullRequests(client, { project: FAKE_TEAM_PROJECT });
    expect(listed.ok && listed.data.pullRequests.find((candidate) => candidate.id === 10598)?.unresolvedThreads).toBe(4);

    // Resolving one in ADO takes it off the count.
    pr.threads[0]!.status = 'fixed';
    const again = await listActivePullRequests(client, { project: FAKE_TEAM_PROJECT });
    expect(again.ok && again.data.pullRequests.find((candidate) => candidate.id === 10598)?.unresolvedThreads).toBe(3);
  });

  it('flags a PR whose repo is not registered in Agent Lanes, so the drop can refuse with "Add repo"', async () => {
    const { client } = setup();
    const none = await listActivePullRequests(client, { project: FAKE_TEAM_PROJECT });
    expect(none.ok && none.data.pullRequests.every((pr) => !pr.repoRegistered)).toBe(true);
    const some = await listActivePullRequests(client, { project: FAKE_TEAM_PROJECT, isRegistered: registered });
    expect(some.ok && some.data.pullRequests.filter((pr) => !pr.repoRegistered).map((pr) => pr.id)).toEqual([10590]);
  });

  it("leaves out PRs that are closed or have nobody from the team on them", async () => {
    const { client } = setup();
    const listed = await listActivePullRequests(client, { project: FAKE_TEAM_PROJECT, team: OSC_DEVELOPERS.name });
    const ids = listed.ok ? listed.data.pullRequests.map((pr) => pr.id) : [];
    expect(ids).not.toContain(10580);
    expect(ids).not.toContain(10604);
    expect(ids).not.toContain(10560);
  });

  it('reads another team by name', async () => {
    const { client } = setup();
    const listed = await listActivePullRequests(client, { project: FAKE_TEAM_PROJECT, team: RELEASE_TRAIN.name });
    // Release Train is only Kyle: his PRs and the ones he reviews.
    expect(listed.ok && listed.data.pullRequests.map((pr) => pr.id)).toEqual([10598, 10571]);
  });

  it('works against Azure DevOps Server through the api-version negotiation', async () => {
    const { client, org } = setup({ serverVersion: '6.0' });
    const listed = await listActivePullRequests(client, { project: FAKE_TEAM_PROJECT });
    expect(listed.ok && listed.data.pullRequests).toHaveLength(3);
    expect(org.state.versionRefusals.length).toBeGreaterThan(0);
  });

  it('fails the whole call when a thread read fails, rather than show a wrong count', async () => {
    const org = createFakeTeamOrg();
    const created = createAdoClient({
      orgUrl: org.orgUrl,
      pat: org.pat,
      sleep: async () => undefined,
      fetch: (input, init) => (input.includes('/pullRequests/10571/threads') ? Promise.resolve(new Response(JSON.stringify({ message: 'gone' }), { status: 404 })) : org.fetch(input, init)),
    });
    if (!created.ok) throw new Error(created.message);
    expect(await listActivePullRequests(created.data, { project: FAKE_TEAM_PROJECT })).toMatchObject({ ok: false, details: { status: 404 } });
  });
});

describe('isUnresolvedThread (AL-232)', () => {
  it.each([
    [{ id: 1, status: 'active', comments: [{ commentType: 'text' }] }, true],
    [{ id: 1, status: 'Active', comments: [{ commentType: 'codeChange' }] }, true],
    [{ id: 1, status: 'pending', comments: [{ commentType: 'text' }] }, false],
    [{ id: 1, status: 'fixed', comments: [{ commentType: 'text' }] }, false],
    [{ id: 1, status: 'closed', comments: [{ commentType: 'text' }] }, false],
    [{ id: 1, status: 'active', isDeleted: true, comments: [{ commentType: 'text' }] }, false],
    [{ id: 1, status: 'active', comments: [{ commentType: 'system' }] }, false],
    [{ id: 1, comments: [{ commentType: 'system' }] }, false],
    [{ id: 1, status: 'active', comments: [] }, false],
  ])('%j → %s', (thread, expected) => {
    expect(isUnresolvedThread(thread)).toBe(expected);
  });
});
