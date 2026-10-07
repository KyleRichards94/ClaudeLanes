import { pickSprint, SprintListSchema, type Sprint } from '@agent-lanes/contracts';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { isAdoErrorDetails } from './errors';
import { listSprints, listTeams, TEAMS_PAGE_SIZE } from './sprints';
import { createTestClient, FAKE_PAT, ORG_URL, useMswServer } from './testing/msw-server';

const server = useMswServer();

const PROJECT = 'Onsite Companion';
const TEAM = 'Onsite Companion Team';
const ITERATIONS_ROUTE = `${ORG_URL}/:project/:team/_apis/work/teamsettings/iterations`;
const DEFAULT_TEAM_ITERATIONS_ROUTE = `${ORG_URL}/:project/_apis/work/teamsettings/iterations`;
/** 7 Oct 2026, mid-morning in Sydney: the first day of Sprint 42 on artboard 1. */
const NOW = new Date(2026, 9, 7, 10, 30).getTime();

interface RawIteration {
  id: string;
  name: string;
  path?: string;
  attributes?: { startDate: string | null; finishDate: string | null; timeFrame?: string };
  url?: string;
}

function iteration(n: number, start: string | null, finish: string | null, timeFrame?: string): RawIteration {
  const id = `00000000-0000-4000-8000-0000000000${n}`;
  return {
    id,
    name: `Sprint ${n}`,
    path: `${PROJECT}\\Sprint ${n}`,
    attributes: {
      startDate: start && `${start}T00:00:00Z`,
      finishDate: finish && `${finish}T00:00:00Z`,
      ...(timeFrame ? { timeFrame } : {}),
    },
    url: `${ORG_URL}/p/t/_apis/work/teamsettings/iterations/${id}`,
  };
}

const sprint40 = iteration(40, '2026-09-09', '2026-09-22', 'past');
const sprint41 = iteration(41, '2026-09-23', '2026-10-06', 'past');
const sprint42 = iteration(42, '2026-10-07', '2026-10-20', 'current');
const sprint43 = iteration(43, '2026-10-21', '2026-11-03', 'future');
const sprint44 = iteration(44, '2026-11-04', '2026-11-17', 'future');
const SPRINT_42_ID = sprint42.id;

/** Answers the team iterations endpoint: the full list, or `current` for `$timeframe=current`. */
function iterationsHandler(all: RawIteration[], current: RawIteration[], seen: URL[] = [], route = ITERATIONS_ROUTE) {
  return http.get(route, ({ request }) => {
    const url = new URL(request.url);
    seen.push(url);
    const value = url.searchParams.get('$timeframe') === 'current' ? current : all;
    return HttpResponse.json({ count: value.length, value });
  });
}

function sprintNames(sprints: Sprint[]): string[] {
  return sprints.map((sprint) => sprint.name);
}

describe('listSprints', () => {
  it('returns past, current and future sprints as DTOs, with the current one from $timeframe=current', async () => {
    const seen: URL[] = [];
    server.use(iterationsHandler([sprint40, sprint41, sprint42, sprint43, sprint44], [sprint42], seen));
    const { client } = createTestClient();

    const result = await listSprints(client, { project: PROJECT, team: TEAM }, { now: () => NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(SprintListSchema.parse(result.data)).toEqual(result.data);
    expect(result.data.currentId).toBe(SPRINT_42_ID);
    expect(result.data.sprints.find((sprint) => sprint.id === SPRINT_42_ID)).toEqual({
      id: SPRINT_42_ID,
      name: 'Sprint 42',
      path: 'Onsite Companion\\Sprint 42',
      start: '2026-10-07',
      finish: '2026-10-20',
      timeFrame: 'current',
    });
    expect(result.data.sprints.map((sprint) => [sprint.name, sprint.timeFrame])).toEqual([
      ['Sprint 40', 'past'],
      ['Sprint 41', 'past'],
      ['Sprint 42', 'current'],
      ['Sprint 43', 'future'],
      ['Sprint 44', 'future'],
    ]);

    // Two requests to the team's iterations, one asking for the current sprint only.
    expect(seen.map((url) => url.pathname).toSorted()).toEqual([
      '/contoso/Onsite%20Companion/Onsite%20Companion%20Team/_apis/work/teamsettings/iterations',
      '/contoso/Onsite%20Companion/Onsite%20Companion%20Team/_apis/work/teamsettings/iterations',
    ]);
    expect(seen.map((url) => url.searchParams.get('$timeframe')).toSorted()).toEqual(['current', null]);
    expect(seen.every((url) => url.searchParams.get('api-version') === '7.1')).toBe(true);
  });

  it('pre-selects the current sprint, and past and future sprints stay selectable', async () => {
    server.use(iterationsHandler([sprint41, sprint42, sprint43], [sprint42]));
    const { client } = createTestClient();
    const result = await listSprints(client, { project: PROJECT, team: TEAM });
    if (!result.ok) throw new Error(result.message);

    expect(pickSprint(result.data)?.name).toBe('Sprint 42');
    expect(pickSprint(result.data, sprint41.id)?.name).toBe('Sprint 41');
    expect(pickSprint(result.data, sprint43.id)?.name).toBe('Sprint 43');
  });

  it("uses the project's default team when no team is given", async () => {
    const seen: URL[] = [];
    server.use(iterationsHandler([sprint42], [sprint42], seen, DEFAULT_TEAM_ITERATIONS_ROUTE));
    const { client } = createTestClient();

    const result = await listSprints(client, { project: PROJECT });

    expect(result).toMatchObject({ ok: true, data: { currentId: SPRINT_42_ID } });
    expect(seen.map((url) => url.pathname)).toEqual([
      '/contoso/Onsite%20Companion/_apis/work/teamsettings/iterations',
      '/contoso/Onsite%20Companion/_apis/work/teamsettings/iterations',
    ]);
  });

  it('encodes project and team names as single path segments', async () => {
    const seen: URL[] = [];
    server.use(iterationsHandler([], [], seen));
    const { client } = createTestClient();

    expect(await listSprints(client, { project: ' Onsite Companion ', team: 'Web/UI' })).toEqual({ ok: true, data: { sprints: [], currentId: null } });
    expect(seen[0]?.pathname).toBe('/contoso/Onsite%20Companion/Web%2FUI/_apis/work/teamsettings/iterations');
  });

  it('sorts sprints oldest first, undated ones last in ADO order', async () => {
    const someday = { ...iteration(90, null, null, 'future'), name: 'Someday' };
    const later = { ...iteration(91, null, null, 'future'), name: 'Later' };
    server.use(iterationsHandler([someday, sprint43, later, sprint41, sprint42], [sprint42]));
    const { client } = createTestClient();

    const result = await listSprints(client, { project: PROJECT, team: TEAM });

    expect(result.ok && sprintNames(result.data.sprints)).toEqual(['Sprint 41', 'Sprint 42', 'Sprint 43', 'Someday', 'Later']);
    expect(result.ok && result.data.sprints.at(-1)).toMatchObject({ start: null, finish: null, timeFrame: 'future' });
  });

  it('has no current sprint between sprints, and then pre-selects the next one', async () => {
    const past = { ...sprint41, attributes: { ...sprint41.attributes!, timeFrame: 'past' } };
    server.use(iterationsHandler([sprint40, past, sprint43], []));
    const { client } = createTestClient();

    const result = await listSprints(client, { project: PROJECT, team: TEAM });

    expect(result.ok && result.data.currentId).toBeNull();
    expect(result.ok && result.data.sprints.map((sprint) => sprint.timeFrame)).toEqual(['past', 'past', 'future']);
    expect(result.ok && pickSprint(result.data)?.name).toBe('Sprint 43');
  });

  it('returns an empty list for a team with no sprints', async () => {
    server.use(iterationsHandler([], []));
    const { client } = createTestClient();
    const result = await listSprints(client, { project: PROJECT, team: TEAM });
    expect(result).toEqual({ ok: true, data: { sprints: [], currentId: null } });
    expect(result.ok && pickSprint(result.data)).toBeNull();
  });

  it('keeps dates as calendar days, whatever time of day or offset-free form ADO sends', async () => {
    const odd = {
      ...iteration(45, null, null, 'future'),
      attributes: { startDate: '2026-11-18T00:00:00', finishDate: '2026-12-01', timeFrame: 'future' },
    };
    server.use(iterationsHandler([sprint42, odd], [sprint42]));
    const { client } = createTestClient();

    const result = await listSprints(client, { project: PROJECT, team: TEAM });

    expect(result.ok && result.data.sprints.map((sprint) => [sprint.start, sprint.finish])).toEqual([
      ['2026-10-07', '2026-10-20'],
      ['2026-11-18', '2026-12-01'],
    ]);
  });

  it('works out past and future from the dates when ADO leaves out the time frame', async () => {
    const strip = (raw: RawIteration): RawIteration => ({ ...raw, attributes: { startDate: raw.attributes!.startDate, finishDate: raw.attributes!.finishDate } });
    server.use(iterationsHandler([strip(sprint41), strip(sprint42), strip(sprint43), { ...strip(iteration(99, null, null)), name: 'Undated' }], [sprint42]));
    const { client } = createTestClient();

    const result = await listSprints(client, { project: PROJECT, team: TEAM }, { now: () => NOW });

    expect(result.ok && result.data.sprints.map((sprint) => [sprint.name, sprint.timeFrame])).toEqual([
      ['Sprint 41', 'past'],
      ['Sprint 42', 'current'],
      ['Sprint 43', 'future'],
      ['Undated', 'future'],
    ]);
  });

  it('works out the time frame from today when there is no current sprint', async () => {
    const strip = (raw: RawIteration): RawIteration => ({ ...raw, attributes: { startDate: raw.attributes!.startDate, finishDate: raw.attributes!.finishDate } });
    server.use(iterationsHandler([strip(sprint41), strip(sprint43)], []));
    const { client } = createTestClient();

    const result = await listSprints(client, { project: PROJECT, team: TEAM }, { now: () => NOW });

    expect(result.ok && result.data.sprints.map((sprint) => sprint.timeFrame)).toEqual(['past', 'future']);
  });

  it('trusts $timeframe=current over a stale "current" in the full list', async () => {
    // ADO's full list still calls Sprint 41 current; $timeframe=current already says Sprint 42.
    const stale41 = { ...sprint41, attributes: { ...sprint41.attributes!, timeFrame: 'current' } };
    const fresh42 = { ...sprint42, attributes: { ...sprint42.attributes!, timeFrame: 'future' } };
    server.use(iterationsHandler([stale41, fresh42, sprint43], [sprint42]));
    const { client } = createTestClient();

    const result = await listSprints(client, { project: PROJECT, team: TEAM });

    expect(result.ok && result.data.currentId).toBe(SPRINT_42_ID);
    expect(result.ok && result.data.sprints.map((sprint) => sprint.timeFrame)).toEqual(['past', 'current', 'future']);
    expect(result.ok && SprintListSchema.safeParse(result.data).success).toBe(true);
  });

  it('adds a current sprint missing from the full list, and ignores one it cannot place', async () => {
    server.use(iterationsHandler([sprint41], [sprint42]));
    const { client } = createTestClient();
    const added = await listSprints(client, { project: PROJECT, team: TEAM });
    expect(added.ok && sprintNames(added.data.sprints)).toEqual(['Sprint 41', 'Sprint 42']);
    expect(added.ok && added.data.currentId).toBe(SPRINT_42_ID);

    // The 7.1 docs' sample answer: `values`, and no path.
    const { path: _path, ...pathless } = sprint42;
    server.use(
      http.get(ITERATIONS_ROUTE, ({ request }) =>
        HttpResponse.json({ values: new URL(request.url).searchParams.has('$timeframe') ? [pathless] : [sprint41] }),
      ),
    );
    const ignored = await listSprints(client, { project: PROJECT, team: TEAM });
    expect(ignored).toMatchObject({ ok: true, data: { currentId: null } });
    expect(ignored.ok && sprintNames(ignored.data.sprints)).toEqual(['Sprint 41']);
  });

  it('refuses an empty project or team without a request', async () => {
    const { client } = createTestClient();
    for (const scope of [{ project: '' }, { project: '  ' }, { project: PROJECT, team: '' }]) {
      const result = await listSprints(client, scope);
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION', details: { source: 'ado', kind: 'config' } });
    }
  });

  it('maps ADO errors and keeps the PAT out of them', async () => {
    const { client } = createTestClient();

    server.use(http.get(ITERATIONS_ROUTE, () => HttpResponse.json({ message: 'TF400813: not authorized' }, { status: 401 })));
    const unauthorized = await listSprints(client, { project: PROJECT, team: TEAM });
    expect(unauthorized).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });

    server.use(
      http.get(ITERATIONS_ROUTE, () =>
        HttpResponse.json({ message: 'VS402371: Team Nope does not exist', typeKey: 'TeamNotFoundException' }, { status: 404 }),
      ),
    );
    const notFound = await listSprints(client, { project: PROJECT, team: 'Nope' });
    expect(notFound).toMatchObject({ ok: false, code: 'INTERNAL', details: { kind: 'http', status: 404, adoTypeKey: 'TeamNotFoundException' } });

    for (const failed of [unauthorized, notFound]) expect(JSON.stringify(failed)).not.toContain(FAKE_PAT);
  });

  it('fails when only the $timeframe=current request fails', async () => {
    server.use(
      http.get(ITERATIONS_ROUTE, ({ request }) =>
        new URL(request.url).searchParams.has('$timeframe')
          ? HttpResponse.json({ message: 'denied' }, { status: 403 })
          : HttpResponse.json({ count: 1, value: [sprint42] }),
      ),
    );
    const { client } = createTestClient();
    expect(await listSprints(client, { project: PROJECT, team: TEAM })).toMatchObject({ ok: false, code: 'ADO_SCOPE_MISSING' });
  });

  it('refuses iterations in an unexpected shape', async () => {
    const badDate = { ...sprint42, attributes: { startDate: 'next Tuesday', finishDate: null } };
    server.use(iterationsHandler([badDate], []));
    const { client } = createTestClient();

    const result = await listSprints(client, { project: PROJECT, team: TEAM });

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION', details: { kind: 'schema' } });
    expect(!result.ok && isAdoErrorDetails(result.details) && result.details.issues?.length).toBeGreaterThan(0);
  });

  it('passes the caller signal through', async () => {
    server.use(iterationsHandler([sprint42], [sprint42]));
    const { client } = createTestClient();
    const controller = new AbortController();
    controller.abort();
    expect(await listSprints(client, { project: PROJECT, team: TEAM }, { signal: controller.signal })).toMatchObject({
      ok: false,
      details: { kind: 'aborted' },
    });
  });
});

describe('listTeams', () => {
  const team = (n: number) => ({ id: `team-${n}`, name: `Team ${n}`, url: `${ORG_URL}/_apis/projects/p/teams/team-${n}`, description: '' });
  const teams = (from: number, count: number) => Array.from({ length: count }, (_, i) => team(from + i));

  it('follows $top/$skip pages until a short page', async () => {
    const all = teams(1, TEAMS_PAGE_SIZE + 30);
    const pages: Array<[string | null, string | null]> = [];
    server.use(
      http.get(`${ORG_URL}/_apis/projects/:project/teams`, ({ request }) => {
        const url = new URL(request.url);
        const top = Number(url.searchParams.get('$top'));
        const skip = Number(url.searchParams.get('$skip'));
        pages.push([url.searchParams.get('$top'), url.searchParams.get('$skip')]);
        const value = all.slice(skip, skip + top);
        return HttpResponse.json({ count: value.length, value });
      }),
    );
    const { client } = createTestClient();

    const result = await listTeams(client, PROJECT);

    expect(result.ok && result.data).toHaveLength(TEAMS_PAGE_SIZE + 30);
    expect(result.ok && result.data[0]).toEqual({ id: 'team-1', name: 'Team 1' });
    expect(result.ok && result.data.at(-1)).toEqual({ id: 'team-130', name: 'Team 130' });
    expect(pages).toEqual([
      ['100', '0'],
      ['100', '100'],
    ]);
  });

  it('asks once more after an exactly full page', async () => {
    let requests = 0;
    server.use(
      http.get(`${ORG_URL}/_apis/projects/:project/teams`, ({ request }) => {
        requests += 1;
        const skip = Number(new URL(request.url).searchParams.get('$skip'));
        return HttpResponse.json({ value: skip === 0 ? teams(1, TEAMS_PAGE_SIZE) : [] });
      }),
    );
    const { client } = createTestClient();
    expect((await listTeams(client, PROJECT)).ok).toBe(true);
    expect(requests).toBe(2);
  });

  it('drops a team repeated across pages', async () => {
    server.use(
      http.get(`${ORG_URL}/_apis/projects/:project/teams`, ({ request }) => {
        const skip = Number(new URL(request.url).searchParams.get('$skip'));
        // A team created between the two requests pushes team 100 onto the second page as well.
        return HttpResponse.json({ value: skip === 0 ? teams(1, TEAMS_PAGE_SIZE) : [team(100), team(101)] });
      }),
    );
    const { client } = createTestClient();
    const result = await listTeams(client, PROJECT);
    expect(result.ok && result.data.map((t) => t.id).slice(-3)).toEqual(['team-99', 'team-100', 'team-101']);
    expect(result.ok && result.data).toHaveLength(101);
  });

  it('encodes the project and fails the whole call when a page fails', async () => {
    const paths: string[] = [];
    server.use(
      http.get(`${ORG_URL}/_apis/projects/:project/teams`, ({ request }) => {
        const url = new URL(request.url);
        paths.push(url.pathname);
        return url.searchParams.get('$skip') === '0'
          ? HttpResponse.json({ value: teams(1, TEAMS_PAGE_SIZE) })
          : HttpResponse.json({ message: 'TF400813' }, { status: 401 });
      }),
    );
    const { client } = createTestClient();
    expect(await listTeams(client, PROJECT)).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });
    expect(paths[0]).toBe('/contoso/_apis/projects/Onsite%20Companion/teams');
  });

  it('refuses an empty project without a request', async () => {
    const { client } = createTestClient();
    expect(await listTeams(client, ' ')).toMatchObject({ ok: false, code: 'VALIDATION', details: { kind: 'config' } });
  });
});
