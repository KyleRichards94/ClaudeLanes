import { describe, expect, it } from 'vitest';
import { createAdoClient } from './client';
import { boardColumnKind, getTeamBoard, gitLinksOf, listMyTeams, teamFieldClause, toPerson } from './team-board';
import { branchLink, createFakeTeamOrg, FAKE_TEAM_PROJECT, OSC_DEVELOPERS, PEOPLE, pullRequestLink, RELEASE_TRAIN, type FakeTeamOrgOptions } from './testing/fake-team';
import { SPRINT_43 } from './testing/fake-work-items';

function setup(options: FakeTeamOrgOptions = {}) {
  const org = createFakeTeamOrg(options);
  const created = createAdoClient({ orgUrl: org.orgUrl, pat: org.pat, fetch: org.fetch, sleep: async () => undefined });
  if (!created.ok) throw new Error(created.message);
  return { org, client: created.data };
}

/** Artboard 08: what each card shows, column by column. */
const ARTBOARD_08 = [
  { id: 71335, column: 'To Do', type: 'User Story', points: 5, assignee: null, branch: null, pullRequestId: null },
  { id: 71341, column: 'To Do', type: 'Bug', points: 3, assignee: 'MD', branch: null, pullRequestId: null },
  { id: 71273, column: 'In Progress', type: 'User Story', points: 8, assignee: 'KR', branch: '71273-cutover-frmjobcontrol-to', pullRequestId: null },
  { id: 71352, column: 'In Progress', type: 'Bug', points: 2, assignee: 'RJ', branch: null, pullRequestId: null },
  { id: 71298, column: 'Code Review', type: 'User Story', points: 5, assignee: 'TY', branch: 'users/ty/71298-invoice-matching', pullRequestId: 10598 },
  { id: 71301, column: 'Code Review', type: 'User Story', points: 3, assignee: 'KR', branch: '71301-defect-request-accept', pullRequestId: 10604 },
  { id: 71287, column: 'Testing', type: 'User Story', points: 2, assignee: 'MD', branch: null, pullRequestId: null },
  { id: 71310, column: 'Testing', type: 'Bug', points: 3, assignee: 'KR', branch: '71310-timesheet-export', pullRequestId: null },
  { id: 71318, column: 'Failed', type: 'Bug', points: 2, assignee: 'KR', branch: null, pullRequestId: null },
];

describe('listMyTeams (AL-231)', () => {
  it("lists the user's teams and defaults to the first when the project's default team isn't theirs", async () => {
    const { client, org } = setup();
    expect(await listMyTeams(client, FAKE_TEAM_PROJECT)).toEqual({
      ok: true,
      data: { teams: [OSC_DEVELOPERS, RELEASE_TRAIN], defaultTeamId: OSC_DEVELOPERS.id },
    });
    expect(org.state.requests.some((request) => request.includes('/teams?') && request.includes('%24mine=true'))).toBe(true);
  });

  it('refuses a blank project without a request', async () => {
    const { client, org } = setup();
    expect(await listMyTeams(client, ' ')).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(org.state.requests).toEqual([]);
  });

  it('a project that does not exist fails with ADO’s 404', async () => {
    const { client } = setup();
    expect(await listMyTeams(client, 'Nope')).toMatchObject({ ok: false, details: { status: 404 } });
  });
});

describe('getTeamBoard (AL-231)', () => {
  it('reads the artboard 08 board: OSC Developers, Sprint 42, by default', async () => {
    const { client } = setup();
    const board = await getTeamBoard(client, { project: FAKE_TEAM_PROJECT });
    expect(board.ok).toBe(true);
    if (!board.ok) return;

    expect(board.data.team).toEqual(OSC_DEVELOPERS);
    expect(board.data.sprint).toEqual({ id: 'it-42', name: 'Sprint 42', path: 'OnSite Companion\\Sprint 42' });
    expect(board.data.columns).toEqual([
      { id: 'c-todo', name: 'To Do', kind: 'to-do' },
      { id: 'c-progress', name: 'In Progress', kind: 'in-progress' },
      { id: 'c-review', name: 'Code Review', kind: 'code-review' },
      { id: 'c-testing', name: 'Testing', kind: 'testing' },
      { id: 'c-failed', name: 'Failed', kind: 'failed' },
    ]);
    expect(
      board.data.items.map(({ id, column, type, points, assignee, branch, pullRequestId }) => ({
        id,
        column,
        type,
        points,
        assignee: assignee?.initials ?? null,
        branch,
        pullRequestId,
      })),
    ).toEqual(ARTBOARD_08);
  });

  it('gives each item id, type, title, points, column, assignee (name + initials), branch and linked PR', async () => {
    const { client } = setup();
    const board = await getTeamBoard(client, { project: FAKE_TEAM_PROJECT, team: 'OSC Developers', sprint: 'OnSite Companion\\Sprint 42' });
    if (!board.ok) throw new Error(board.message);
    expect(board.data.items.find((item) => item.id === 71301)).toEqual({
      id: 71301,
      type: 'User Story',
      title: 'Defect request accept modal',
      state: 'Active',
      points: 3,
      columnId: 'c-review',
      column: 'Code Review',
      columnKind: 'code-review',
      assignee: { id: PEOPLE.KR.id, displayName: 'Kyle Richards', uniqueName: 'kyle.richards@example.com', initials: 'KR' },
      branch: '71301-defect-request-accept',
      pullRequestId: 10604,
      webUrl: 'https://dev.azure.com/CompanionSystems/OnSite%20Companion/_workitems/edit/71301',
    });
  });

  it('keeps the board’s own column names and shows a column it doesn’t know instead of dropping it', async () => {
    const { client, org } = setup();
    org.state.boardColumns[0]!.name = 'Ready';
    org.state.boardColumns.splice(3, 0, { id: 'c-blocked', name: 'Blocked', itemLimit: 0, columnType: 'inProgress', isSplit: false, stateMappings: { 'User Story': 'Active', Bug: 'Active' } });
    for (const item of org.state.workItems.items) if (item.boardColumn === 'To Do') item.boardColumn = 'Ready';
    org.state.workItems.items.find((item) => item.id === 71352)!.boardColumn = 'Blocked';
    // A column the board settings don't list (renamed since): shown after the board's own.
    org.state.workItems.items.find((item) => item.id === 71287)!.boardColumn = 'Awaiting Release';

    const board = await getTeamBoard(client, { project: FAKE_TEAM_PROJECT });
    if (!board.ok) throw new Error(board.message);
    expect(board.data.columns.map(({ name, kind }) => `${name}:${kind}`)).toEqual([
      'Ready:to-do',
      'In Progress:in-progress',
      'Code Review:code-review',
      'Blocked:other',
      'Testing:testing',
      'Failed:failed',
      'Awaiting Release:other',
    ]);
    expect(board.data.items.find((item) => item.id === 71352)).toMatchObject({ column: 'Blocked', columnKind: 'other', columnId: 'c-blocked' });
    expect(board.data.items.find((item) => item.id === 71287)).toMatchObject({ column: 'Awaiting Release', columnId: 'unknown:Awaiting Release' });
  });

  it('reads another sprint by path or id, and refuses one the team does not have', async () => {
    const { client } = setup();
    const next = await getTeamBoard(client, { project: FAKE_TEAM_PROJECT, sprint: SPRINT_43 });
    expect(next.ok && next.data.items.map((item) => item.id)).toEqual([71400]);
    const byId = await getTeamBoard(client, { project: FAKE_TEAM_PROJECT, sprint: 'it-43' });
    expect(byId.ok && byId.data.sprint.name).toBe('Sprint 43');
    expect(await getTeamBoard(client, { project: FAKE_TEAM_PROJECT, sprint: 'Sprint 99' })).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('asks WIQL for the sprint, the team’s area and the board’s types only', async () => {
    const { client, org } = setup();
    await getTeamBoard(client, { project: FAKE_TEAM_PROJECT });
    expect(org.state.workItems.wiql.at(-1)?.query).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.IterationPath] = 'OnSite Companion\\Sprint 42' AND ([System.AreaPath] UNDER 'OnSite Companion\\OSC') AND [System.WorkItemType] IN ('User Story', 'Bug') ORDER BY [System.Id] ASC",
    );
  });

  it('works against Azure DevOps Server through the api-version negotiation', async () => {
    const { client, org } = setup({ serverVersion: '6.0' });
    const board = await getTeamBoard(client, { project: FAKE_TEAM_PROJECT });
    expect(board.ok && board.data.items.length).toBe(ARTBOARD_08.length);
    expect(org.state.versionRefusals.length).toBeGreaterThan(0);
    expect(org.state.requests.at(-1)).toContain('api-version=6.0');
  });

  it('fails with ADO’s 404 for a team that does not exist', async () => {
    const { client } = setup();
    expect(await getTeamBoard(client, { project: FAKE_TEAM_PROJECT, team: 'Nobody' })).toMatchObject({ ok: false, details: { status: 404 } });
  });
});

describe('team board helpers (AL-231)', () => {
  it('maps column names to the app’s columns; the Done column is left out', () => {
    expect(boardColumnKind({ name: 'New', columnType: 'incoming' })).toBe('to-do');
    expect(boardColumnKind({ name: 'Closed', columnType: 'outgoing' })).toBe('done');
    expect(boardColumnKind({ name: 'Active' })).toBe('in-progress');
    expect(boardColumnKind({ name: 'PR Review' })).toBe('code-review');
    expect(boardColumnKind({ name: 'QA' })).toBe('testing');
    expect(boardColumnKind({ name: 'Failed UAT' })).toBe('failed');
    expect(boardColumnKind({ name: 'Blocked' })).toBe('other');
  });

  it('reads the newest linked PR and the first branch from artifact links', () => {
    expect(gitLinksOf([pullRequestLink(10560), branchLink('feature/a b'), pullRequestLink(10604), branchLink('second')])).toEqual({ pullRequestId: 10604, branch: 'feature/a b' });
    expect(gitLinksOf(undefined)).toEqual({ pullRequestId: null, branch: null });
    expect(gitLinksOf([{ rel: 'System.LinkTypes.Related', url: 'vstfs:///Git/PullRequestId/x%2Fy%2F5' }])).toEqual({ pullRequestId: null, branch: null });
  });

  it('builds the area clause from the team field values', () => {
    expect(
      teamFieldClause({
        field: { referenceName: 'System.AreaPath' },
        values: [
          { value: "O'Brien\\A", includeChildren: true },
          { value: 'P\\B', includeChildren: false },
        ],
      }),
    ).toBe("([System.AreaPath] UNDER 'O''Brien\\A' OR [System.AreaPath] = 'P\\B')");
    expect(teamFieldClause({ field: { referenceName: 'System.AreaPath' }, values: [] })).toBeNull();
  });

  it('reads an assignee from an identity or from "Name <email>"', () => {
    expect(toPerson('Mia Davies <mia@example.com>')).toEqual({ id: null, displayName: 'Mia Davies', uniqueName: 'mia@example.com', initials: 'MD' });
    expect(toPerson(null)).toBeNull();
  });
});
