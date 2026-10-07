import { describe, expect, it } from 'vitest';
import { formatPullRequestActivity, PullRequestSnapshotSchema } from '../domains/ado.pull-requests';
import { pickSprint, SprintListSchema, WorkItemSchema } from '../domains/ado.schemas';
import { WorkItemCommentSchema } from '../domains/ado.write-back';
import {
  ADO_FIXTURE_ORG_URL,
  ADO_FIXTURE_SPRINT_42_ID,
  ADO_FIXTURE_SPRINT_42_ITEM_IDS,
  ADO_FIXTURE_SPRINT_42_PATH,
  adoFixture,
  adoFixtureWorkItem,
} from './ado-fixtures';

describe('the shared ADO fixture (AL-065)', () => {
  it('is valid against every DTO schema', () => {
    const fixture = adoFixture();
    expect(SprintListSchema.parse(fixture.sprints)).toEqual(fixture.sprints);
    for (const item of fixture.workItems) expect(WorkItemSchema.parse(item)).toEqual(item);
    for (const comments of Object.values(fixture.comments)) for (const comment of comments) expect(WorkItemCommentSchema.parse(comment)).toEqual(comment);
    for (const snapshot of fixture.pullRequests) expect(PullRequestSnapshotSchema.parse(snapshot)).toEqual(snapshot);
  });

  it('shows the artboards: Sprint 42 (7 – 20 Oct) current with #71273, #71330, #71335 and #71341, and PR !10612 at 3 / 4 checks', () => {
    const fixture = adoFixture();
    expect(pickSprint(fixture.sprints)).toMatchObject({ id: ADO_FIXTURE_SPRINT_42_ID, name: 'Sprint 42', start: '2026-10-07', finish: '2026-10-20' });
    expect(fixture.workItems.filter((item) => item.iterationPath === ADO_FIXTURE_SPRINT_42_PATH).map((item) => item.id)).toEqual([...ADO_FIXTURE_SPRINT_42_ITEM_IDS]);
    expect(fixture.workItems.slice(0, 4).map((item) => `#${item.id} ${item.title} · ${item.type} · ${item.state}`)).toEqual([
      '#71273 Cutover frmJobControl to Blazor · User Story · Active',
      '#71330 Asset register paging slow above 5k rows · Bug · New',
      '#71335 Client portal: show defect photos inline · User Story · New',
      '#71341 Roster view ignores public holidays · Bug · New',
    ]);
    const [snapshot] = fixture.pullRequests;
    expect(snapshot && formatPullRequestActivity(snapshot.pullRequest, snapshot.checks)).toBe('PR !10612 · 3 / 4 checks');
    expect(fixture.comments[71273]?.map((comment) => comment.fromAgentLanes)).toEqual([false, true]);
  });

  it('builds every web URL under the organisation it is given, so e2e can serve it from a loopback port', () => {
    const local = 'http://127.0.0.1:4321/contoso';
    const fixture = adoFixture(local);
    const urls = [
      ...fixture.workItems.map((item) => item.webUrl),
      ...fixture.pullRequests.flatMap(({ pullRequest, checks }) => [pullRequest.webUrl, ...checks.checks.flatMap((check) => (check.url ? [check.url] : []))]),
    ];
    expect(urls.length).toBeGreaterThan(5);
    for (const url of urls) expect(url.startsWith(`${local}/`)).toBe(true);
    expect(adoFixtureWorkItem(71273).webUrl).toBe(`${ADO_FIXTURE_ORG_URL}/OnSite%20Companion/_workitems/edit/71273`);
  });

  it('hands out a fresh copy each time, so a test can change it freely', () => {
    const first = adoFixture();
    first.workItems[0]!.state = 'Closed';
    first.sprints.sprints.pop();
    expect(adoFixture().workItems[0]!.state).toBe('Active');
    expect(adoFixture().sprints.sprints).toHaveLength(5);
    expect(() => adoFixtureWorkItem(1)).toThrow('#1');
  });
});
