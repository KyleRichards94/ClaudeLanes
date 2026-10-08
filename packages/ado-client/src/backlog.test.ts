import type { BacklogPage } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { backlogQuery, getBacklog } from './backlog';
import { createAdoClient } from './client';
import { artboard11Backlog, createFakeTeamOrg, FAKE_TEAM_PROJECT, FEATURES, OSC_AREA, OSC_DEVELOPERS, type FakeTeamOrgOptions } from './testing/fake-team';

function setup(options: FakeTeamOrgOptions = {}) {
  const org = createFakeTeamOrg({ items: artboard11Backlog(), ...options });
  const created = createAdoClient({ orgUrl: org.orgUrl, pat: org.pat, fetch: org.fetch, sleep: async () => undefined });
  if (!created.ok) throw new Error(created.message);
  return { org, client: created.data };
}

const ids = (page: BacklogPage) => page.groups.flatMap((group) => group.items.map((item) => item.id));
const groupsOf = (page: BacklogPage) => page.groups.map((group) => `${group.feature?.title ?? 'No feature'} ${group.items.length}`);

async function read(client: Parameters<typeof getBacklog>[0], options: Omit<Parameters<typeof getBacklog>[1], 'project'> = {}) {
  const page = await getBacklog(client, { project: FAKE_TEAM_PROJECT, ...options });
  if (!page.ok) throw new Error(page.message);
  return page.data;
}

describe('getBacklog (AL-233)', () => {
  it("reads artboard 11's 48-item backlog in backlog order, the first rows grouped by Feature", async () => {
    const { client } = setup();
    const page = await read(client, { page: { index: 0, size: 7 } });
    expect(page.team).toEqual(OSC_DEVELOPERS);
    expect(page.total).toBe(48);
    expect(page.page).toEqual({ index: 0, size: 7, count: 7 });
    // The artboard's rows, under the artboard's group headings.
    expect(groupsOf(page)).toEqual(['Job management 3', 'Client portal 3', 'Timesheets 1']);
    expect(ids(page)).toEqual([71360, 71362, 71371, 71335, 71377, 71380, 71384]);
    expect(page.groups[0]!.items[0]).toEqual({
      id: 71360,
      type: 'User Story',
      kind: 'story',
      title: 'Bulk reassign jobs between technicians',
      state: 'New',
      points: 5,
      priority: 1,
      tags: ['jobs'],
      areaPath: OSC_AREA,
      iterationPath: 'OnSite Companion',
      inSprint: false,
      assignee: null,
      parentId: FEATURES.jobs.id,
      webUrl: 'https://dev.azure.com/CompanionSystems/OnSite%20Companion/_workitems/edit/71360',
    });
    expect(page.groups[1]!.items.find((item) => item.id === 71380)?.tags).toEqual(['quotes', 'portal']);
    expect(page.groups[2]!.items[0]).toMatchObject({ kind: 'task', type: 'Task' });
  });

  it('pages through all 48 in order, each page grouped on its own', async () => {
    const { client } = setup();
    const all = await read(client, { page: { index: 0, size: 48 } });
    const pages = await Promise.all([0, 1, 2, 3].map((index) => read(client, { page: { index, size: 20 } })));
    expect(pages.map((page) => [page.total, page.page.count, ids(page).length])).toEqual([
      [48, 3, 20],
      [48, 3, 20],
      [48, 3, 8],
      [48, 3, 0],
    ]);
    // Backlog order is the fixture's rank order: page n holds rows 20n…20n+19 of it.
    const order = artboard11Backlog()
      .filter((item) => ids(all).includes(item.id))
      .map((item) => item.id);
    expect(order).toHaveLength(48);
    const sorted = (list: readonly number[]) => [...list].sort((a, b) => a - b);
    pages.forEach((page, index) => expect(sorted(ids(page))).toEqual(sorted(order.slice(index * 20, index * 20 + 20))));
    for (const group of [...pages, all].flatMap((page) => page.groups)) {
      const positions = group.items.map((item) => order.indexOf(item.id));
      expect(positions).toEqual(sorted(positions));
    }
    expect(pages[3]!.groups).toEqual([]);

    // Groups follow each Feature's first row; a row's position in its group keeps backlog order.
    for (const page of pages) {
      const seen = new Set<number | null>();
      for (const group of page.groups) {
        expect(seen.has(group.feature?.id ?? null)).toBe(false);
        seen.add(group.feature?.id ?? null);
      }
    }
    expect(all.groups.map((group) => group.feature?.title ?? null)).toEqual(['Job management', 'Client portal', 'Timesheets', 'Asset register', 'Reporting', null]);
    expect(all.groups.reduce((sum, group) => sum + group.items.length, 0)).toBe(48);
  });

  it('finds the Feature above a task whose parent is a story', async () => {
    const { client } = setup();
    const all = await read(client, { page: { index: 0, size: 48 } });
    const jobs = all.groups.find((group) => group.feature?.id === FEATURES.jobs.id)!;
    expect(jobs.items.find((item) => item.id === 71402)).toMatchObject({ kind: 'task', parentId: 71371 });
  });

  it('leaves out items in a sprint unless asked, and closed, removed and other teams’ items always', async () => {
    const { client } = setup();
    const backlog = ids(await read(client, { page: { index: 0, size: 200 } }));
    for (const id of [71500, 71501, 71502, 71503, 71504, 70101]) expect(backlog).not.toContain(id);

    const withSprints = await read(client, { filters: { includeInSprint: true }, page: { index: 0, size: 200 } });
    expect(withSprints.total).toBe(50);
    const planned = withSprints.groups.flatMap((group) => group.items).filter((item) => item.inSprint);
    expect(planned.map((item) => [item.id, item.iterationPath])).toEqual([
      [71500, 'OnSite Companion\\Sprint 42'],
      [71501, 'OnSite Companion\\Sprint 43'],
    ]);
  });

  it('applies each filter in WIQL', async () => {
    const { client } = setup();
    const kinds = await read(client, { filters: { kinds: ['bug'] }, page: { index: 0, size: 200 } });
    expect(kinds.groups.flatMap((group) => group.items).every((item) => item.kind === 'bug')).toBe(true);
    expect(kinds.total).toBe(2 + 14);

    const priority = await read(client, { filters: { priorities: [1] }, page: { index: 0, size: 200 } });
    expect(priority.groups.flatMap((group) => group.items).every((item) => item.priority === 1)).toBe(true);

    const area = await read(client, { filters: { areas: [`${OSC_AREA}\\Portal`] } });
    expect(ids(area)).toEqual([71377]);

    const tag = await read(client, { filters: { tags: ['quotes'] } });
    expect(ids(tag)).toEqual([71380]);

    expect(ids(await read(client, { filters: { text: '#71362' } }))).toEqual([71362]);
    expect(ids(await read(client, { filters: { text: 'payroll' } }))).toEqual([71384]);
    expect(ids(await read(client, { filters: { text: 'reassign' } }))).toEqual([71360]);
  });

  it('combines filters with AND, server-side', async () => {
    const { client, org } = setup();
    const page = await read(client, { filters: { kinds: ['story', 'bug'], priorities: [1, 2], tags: ['portal'], text: 'portal' }, page: { index: 0, size: 200 } });
    const rows = page.groups.flatMap((group) => group.items);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(['story', 'bug']).toContain(row.kind);
      expect([1, 2]).toContain(row.priority);
      expect(row.tags).toContain('portal');
    }
    // Only the page's rows are read: the filtering happened in the query.
    expect(page.total).toBe(rows.length);
    expect(org.state.workItems.wiql.at(-1)?.query).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] IN ('User Story', 'Bug') AND [System.State] <> 'Closed' AND [System.State] <> 'Removed' AND [System.IterationPath] = 'OnSite Companion' AND ([System.AreaPath] UNDER 'OnSite Companion\\OSC') AND [Microsoft.VSTS.Common.Priority] IN (1, 2) AND [System.Tags] CONTAINS 'portal' AND ([System.Title] CONTAINS 'portal' OR [System.Tags] CONTAINS 'portal') ORDER BY [Microsoft.VSTS.Common.StackRank] ASC, [System.Id] ASC",
    );
    const sorted = (list: readonly number[]) => [...list].sort((a, b) => a - b).join();
    expect(org.state.workItems.batches.some((batch) => sorted(batch) === sorted(ids(page)))).toBe(true);
  });

  it('works against Azure DevOps Server through the api-version negotiation', async () => {
    const { client, org } = setup({ serverVersion: '6.0' });
    expect((await read(client)).total).toBe(48);
    expect(org.state.versionRefusals.length).toBeGreaterThan(0);
  });

  it('refuses a blank project without a request', async () => {
    const { client, org } = setup();
    expect(await getBacklog(client, { project: '' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(org.state.requests).toEqual([]);
  });
});

describe('backlogQuery (AL-233)', () => {
  const setup = {
    types: { story: ['Product Backlog Item'], bug: ['Bug'], task: [] },
    orderField: 'Microsoft.VSTS.Common.BacklogPriority',
    closedStates: ['Done', 'Removed'],
    area: null,
    backlogIteration: "O'Brien",
  };

  it('quotes every value, and a kind with no types matches nothing', () => {
    expect(backlogQuery(setup, { kinds: ['task'], text: "it's" })).toBe(
      "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Id] = 0 AND [System.State] <> 'Done' AND [System.State] <> 'Removed' AND [System.IterationPath] = 'O''Brien' AND ([System.Title] CONTAINS 'it''s' OR [System.Tags] CONTAINS 'it''s') ORDER BY [Microsoft.VSTS.Common.BacklogPriority] ASC, [System.Id] ASC",
    );
  });

  it('includes items in sprints with UNDER the backlog iteration', () => {
    expect(backlogQuery(setup, { includeInSprint: true })).toContain("[System.IterationPath] UNDER 'O''Brien'");
  });
});
