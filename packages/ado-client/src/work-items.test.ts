import { WorkItemSchema, type WorkItem } from '@agent-lanes/contracts';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { isAdoErrorDetails } from './errors';
import { toStateCategory } from './work-item-states';
import {
  DEFAULT_SPRINT_MAX_ITEMS,
  getWorkItem,
  getWorkItems,
  listSprintWorkItems,
  searchWorkItems,
  WORK_ITEM_FIELDS,
  WORK_ITEMS_BATCH_SIZE,
} from './work-items';
import { artboardWorkItems, FAKE_PROJECT, installFakeWorkItems, sprint42Backlog, SPRINT_42, type FakeWorkItem } from './testing/fake-work-items';
import { createTestClient, FAKE_AUTHORIZATION, FAKE_PAT, ORG_URL, useMswServer } from './testing/msw-server';

const server = useMswServer();

/** Sprint 42 as on artboard 2 plus 246 tasks: 250 stories, bugs and tasks. */
const SPRINT_SIZE = 250;
const backlog = () => sprint42Backlog(SPRINT_SIZE - 4);

/** #71273 exactly as the New agent ticket modal and the drill-in get it (artboards 2 and 3). */
const ITEM_71273: WorkItem = {
  id: 71273,
  project: 'OnSite Companion',
  type: 'User Story',
  title: 'Cutover frmJobControl to Blazor',
  state: 'Active',
  stateCategory: 'in-progress',
  assignedTo: { displayName: 'Kyle Richards', uniqueName: 'kyle.richards@example.com' },
  iterationPath: 'OnSite Companion\\Sprint 42',
  description: '<div>Cut frmJobControl over to Blazor. Keep the WinForms child modals invoked via IWinFormsInvoker.</div>',
  acceptanceCriteria: '<ul><li>Grid filters work as in WinForms.</li></ul>',
  webUrl: 'https://dev.azure.com/contoso/OnSite%20Companion/_workitems/edit/71273',
};

function ids(result: { ok: boolean; data?: WorkItem[] }): number[] {
  if (!result.ok || !result.data) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result.data.map((workItem) => workItem.id);
}

describe('listSprintWorkItems', () => {
  it('returns every story, bug and task of a 250-item sprint, reading them in pages of 200', async () => {
    const fake = installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    const result = await listSprintWorkItems(client, { project: FAKE_PROJECT, iterationPath: SPRINT_42 });

    const listed = ids(result);
    expect(listed).toHaveLength(SPRINT_SIZE);
    expect(listed.slice(0, 4)).toEqual([71273, 71330, 71335, 71341]);
    expect(listed).toEqual([...listed].sort((a, b) => a - b));
    // The Epic, the Feature, Sprint 43 and the other project's sprint are left out.
    expect(listed).not.toContain(70001);
    expect(listed).not.toContain(70002);
    expect(listed).not.toContain(71400);
    expect(listed).not.toContain(71500);
    expect(fake.batches.map((batch) => batch.length)).toEqual([WORK_ITEMS_BATCH_SIZE, SPRINT_SIZE - WORK_ITEMS_BATCH_SIZE]);
    expect(fake.batches.flat()).toEqual(listed);
    for (const workItem of result.ok ? result.data : []) expect(WorkItemSchema.safeParse(workItem).success).toBe(true);
  });

  it('maps fields, state category, assignee and web URL into the DTO', async () => {
    installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    const result = await listSprintWorkItems(client, { project: FAKE_PROJECT, iterationPath: SPRINT_42 });

    expect(result.ok && result.data.find((workItem) => workItem.id === 71273)).toEqual(ITEM_71273);
    expect(result.ok && result.data.find((workItem) => workItem.id === 71330)).toEqual({
      id: 71330,
      project: FAKE_PROJECT,
      type: 'Bug',
      title: 'Asset register paging slow above 5k rows',
      state: 'New',
      stateCategory: 'proposed',
      assignedTo: null,
      iterationPath: SPRINT_42,
      description: null,
      acceptanceCriteria: null,
      webUrl: 'https://dev.azure.com/contoso/OnSite%20Companion/_workitems/edit/71330',
    });
    const categories = new Set(result.ok ? result.data.filter((workItem) => workItem.type === 'Task').map((task) => `${task.state}:${task.stateCategory}`) : []);
    expect(categories).toEqual(new Set(['New:proposed', 'Active:in-progress', 'Closed:completed']));
  });

  it('asks WIQL for the project and iteration, stories/bugs/tasks by category, lowest id first', async () => {
    const fake = installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    await listSprintWorkItems(client, { project: FAKE_PROJECT, iterationPath: SPRINT_42 });

    expect(fake.wiql).toEqual([
      {
        project: FAKE_PROJECT,
        top: DEFAULT_SPRINT_MAX_ITEMS,
        query:
          "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.IterationPath] = 'OnSite Companion\\Sprint 42' AND " +
          "([System.WorkItemType] IN GROUP 'Microsoft.RequirementCategory' OR [System.WorkItemType] IN GROUP 'Microsoft.BugCategory' OR " +
          "[System.WorkItemType] IN GROUP 'Microsoft.TaskCategory') ORDER BY [System.Id] ASC",
      },
    ]);
  });

  it('reads the fields the ticket names, plus the project', async () => {
    let fields: unknown;
    let errorPolicy: unknown;
    installFakeWorkItems(server, backlog());
    server.use(
      http.post(`${ORG_URL}/_apis/wit/workitemsbatch`, async ({ request }) => {
        ({ fields, errorPolicy } = (await request.clone().json()) as { fields: unknown; errorPolicy: unknown });
        return undefined;
      }),
    );
    const { client } = createTestClient();

    await listSprintWorkItems(client, { project: FAKE_PROJECT, iterationPath: SPRINT_42, maxItems: 1 });

    expect(fields).toEqual([...WORK_ITEM_FIELDS]);
    expect(fields).toEqual(
      expect.arrayContaining([
        'System.Id',
        'System.Title',
        'System.WorkItemType',
        'System.State',
        'System.AssignedTo',
        'System.IterationPath',
        'System.Description',
        'Microsoft.VSTS.Common.AcceptanceCriteria',
        'System.TeamProject',
      ]),
    );
    expect(errorPolicy).toBe('omit');
  });

  it('takes configurable work item types', async () => {
    const fake = installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    const bugs = await listSprintWorkItems(client, { project: FAKE_PROJECT, iterationPath: SPRINT_42, types: ['Bug'] });
    const planning = await listSprintWorkItems(client, { project: FAKE_PROJECT, iterationPath: SPRINT_42, types: ['Epic', 'Feature', 'User Story'] });

    expect(ids(bugs)).toEqual([71330, 71341]);
    expect(ids(planning)).toEqual([70001, 70002, 71273, 71335]);
    expect(fake.wiql[1]?.query).toContain("[System.WorkItemType] IN ('Epic', 'Feature', 'User Story')");
  });

  it('quotes the iteration path and type names, so a quote in them is matched, not run', async () => {
    const path = `${FAKE_PROJECT}\\Dev's sprint`;
    const fake = installFakeWorkItems(server, [
      ...artboardWorkItems(),
      { id: 90001, project: FAKE_PROJECT, type: "Dev's Bug", title: 'Quoted', state: 'New', iterationPath: path, changedDate: '2026-10-01T00:00:00Z' },
    ]);
    fake.states["Dev's Bug"] = [{ name: 'New', category: 'Proposed' }];
    const { client } = createTestClient();

    const result = await listSprintWorkItems(client, { project: FAKE_PROJECT, iterationPath: path, types: ["Dev's Bug"] });

    expect(ids(result)).toEqual([90001]);
    expect(fake.wiql[0]?.query).toContain(`[System.IterationPath] = 'OnSite Companion\\Dev''s sprint'`);
    expect(fake.wiql[0]?.query).toContain(`IN ('Dev''s Bug')`);
  });

  it('stops at maxItems', async () => {
    const fake = installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    const result = await listSprintWorkItems(client, { project: FAKE_PROJECT, iterationPath: SPRINT_42, maxItems: 10 });

    expect(ids(result)).toHaveLength(10);
    expect(fake.wiql[0]?.top).toBe(10);
  });

  it('returns an empty sprint without reading any items', async () => {
    const fake = installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    const result = await listSprintWorkItems(client, { project: FAKE_PROJECT, iterationPath: `${FAKE_PROJECT}\\Sprint 99` });

    expect(result).toEqual({ ok: true, data: [] });
    expect(fake.batches).toEqual([]);
    expect(fake.stateReads).toEqual([]);
  });

  it('leaves out an item deleted between the query and the read', async () => {
    const fake = installFakeWorkItems(server, backlog());
    fake.unreadable.add(71330);
    const { client } = createTestClient();

    const result = await listSprintWorkItems(client, { project: FAKE_PROJECT, iterationPath: SPRINT_42 });

    expect(ids(result)).toHaveLength(SPRINT_SIZE - 1);
    expect(ids(result)).not.toContain(71330);
  });

  it('fails the whole list when a page fails, rather than returning part of the sprint', async () => {
    installFakeWorkItems(server, backlog());
    let pages = 0;
    server.use(
      // The first page goes on to the fake; the second fails.
      http.post(`${ORG_URL}/_apis/wit/workitemsbatch`, () => ((pages += 1) > 1 ? HttpResponse.json({ message: 'boom' }, { status: 500 }) : undefined)),
    );
    const { client } = createTestClient();

    const result = await listSprintWorkItems(client, { project: FAKE_PROJECT, iterationPath: SPRINT_42 });

    expect(result).toMatchObject({ ok: false, code: 'INTERNAL', details: { kind: 'http', status: 500 } });
    expect(pages).toBe(2);
  });

  it('passes a rejected PAT through as ADO_UNAUTHORIZED, without the PAT', async () => {
    server.use(
      http.post(`${ORG_URL}/:project/_apis/wit/wiql`, ({ request }) =>
        HttpResponse.json({ message: `TF400813: ${request.headers.get('authorization')} is not authorized` }, { status: 401 }),
      ),
    );
    const { client } = createTestClient();

    const result = await listSprintWorkItems(client, { project: FAKE_PROJECT, iterationPath: SPRINT_42 });

    expect(result).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });
    expect(JSON.stringify(result)).not.toContain(FAKE_PAT);
    expect(JSON.stringify(result)).not.toContain(FAKE_AUTHORIZATION.slice('Basic '.length));
  });

  it.each([
    ['an empty project', { project: ' ', iterationPath: SPRINT_42 }],
    ['an empty iteration path', { project: FAKE_PROJECT, iterationPath: '' }],
    ['a newline in the iteration path', { project: FAKE_PROJECT, iterationPath: `${SPRINT_42}'\nOR 1=1` }],
    ['no types', { project: FAKE_PROJECT, iterationPath: SPRINT_42, types: [] }],
    ['a blank type', { project: FAKE_PROJECT, iterationPath: SPRINT_42, types: ['Bug', ' '] }],
    ['maxItems 0', { project: FAKE_PROJECT, iterationPath: SPRINT_42, maxItems: 0 }],
    ['maxItems above WIQL’s 20 000', { project: FAKE_PROJECT, iterationPath: SPRINT_42, maxItems: 20_001 }],
  ])('refuses %s before sending anything', async (_case, options) => {
    const fake = installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    const result = await listSprintWorkItems(client, options);

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION', details: { source: 'ado', kind: 'config' } });
    expect(fake.requests).toBe(0);
  });
});

describe('searchWorkItems', () => {
  it.each(['71273', '#71273', ' 71273 '])('finds #71273 by its id (%j)', async (query) => {
    installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    const result = await searchWorkItems(client, { project: FAKE_PROJECT, query });

    expect(result.ok && result.data[0]).toEqual(ITEM_71273);
  });

  it.each(['frmJobControl', 'FRMJOBCONTROL', 'cutover frmjob'])('finds #71273 by part of its title (%j)', async (query) => {
    installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    const result = await searchWorkItems(client, { project: FAKE_PROJECT, query });

    // 71500 has the same title but is in another project.
    expect(ids(result)).toEqual([71273]);
    expect(result.ok && result.data[0]).toEqual(ITEM_71273);
  });

  it('lists the exact id first, then titles containing the number, most recently changed first', async () => {
    const fake = installFakeWorkItems(server, [
      ...backlog(),
      { id: 71280, project: FAKE_PROJECT, type: 'Task', title: 'Grid for 71273', state: 'New', iterationPath: SPRINT_42, changedDate: '2026-10-07T01:00:00Z' },
      { id: 71290, project: FAKE_PROJECT, type: 'Bug', title: 'Regression from 71273', state: 'Active', iterationPath: SPRINT_42, changedDate: '2026-10-07T02:00:00Z' },
    ]);
    const { client } = createTestClient();

    const result = await searchWorkItems(client, { project: FAKE_PROJECT, query: '71273' });

    expect(ids(result)).toEqual([71273, 71290, 71280]);
    expect(fake.wiql.map((call) => call.query)).toEqual(
      expect.arrayContaining([
        'SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Id] = 71273',
        "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND ([System.WorkItemType] IN GROUP 'Microsoft.RequirementCategory' OR " +
          "[System.WorkItemType] IN GROUP 'Microsoft.BugCategory' OR [System.WorkItemType] IN GROUP 'Microsoft.TaskCategory') AND " +
          "[System.Title] CONTAINS '71273' ORDER BY [System.ChangedDate] DESC",
      ]),
    );
  });

  it('keeps the exact id match even when title matches fill the limit', async () => {
    const older = artboardWorkItems().map((workItem) => ({ ...workItem, changedDate: '2020-01-01T00:00:00Z' }));
    const newer: FakeWorkItem[] = Array.from({ length: 5 }, (_, i) => ({
      id: 72000 + i,
      project: FAKE_PROJECT,
      type: 'Task',
      title: `Follow-up ${i} to 71273`,
      state: 'New',
      iterationPath: SPRINT_42,
      changedDate: `2026-10-0${i + 1}T00:00:00Z`,
    }));
    installFakeWorkItems(server, [...older, ...newer]);
    const { client } = createTestClient();

    const result = await searchWorkItems(client, { project: FAKE_PROJECT, query: '71273', top: 3 });

    expect(ids(result)).toEqual([71273, 72004, 72003]);
  });

  it('matches an exact id of any type, but searches titles only in the configured types', async () => {
    installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    expect(ids(await searchWorkItems(client, { project: FAKE_PROJECT, query: '70001' }))).toEqual([70001]);
    expect(ids(await searchWorkItems(client, { project: FAKE_PROJECT, query: 'Blazor' }))).toEqual([71273]);
    expect(ids(await searchWorkItems(client, { project: FAKE_PROJECT, query: 'Blazor', types: ['Epic', 'User Story'] }))).toEqual([71273, 70001]);
  });

  it('does not find an id from another project', async () => {
    installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    expect(await searchWorkItems(client, { project: FAKE_PROJECT, query: '71500' })).toEqual({ ok: true, data: [] });
  });

  it('quotes the search text, so a quote in it is matched, not run', async () => {
    const fake = installFakeWorkItems(server, [
      ...backlog(),
      { id: 71350, project: FAKE_PROJECT, type: 'Bug', title: "Client's portal times out", state: 'New', iterationPath: SPRINT_42, changedDate: '2026-10-02T00:00:00Z' },
    ]);
    const { client } = createTestClient();

    expect(ids(await searchWorkItems(client, { project: FAKE_PROJECT, query: "client's" }))).toEqual([71350]);
    expect(ids(await searchWorkItems(client, { project: FAKE_PROJECT, query: "x' OR [System.Id] > '0" }))).toEqual([]);
    expect(fake.wiql[0]?.query).toContain("[System.Title] CONTAINS 'client''s'");
  });

  it('searches only titles for a number that cannot be an id', async () => {
    const fake = installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    expect(await searchWorkItems(client, { project: FAKE_PROJECT, query: '99999999999' })).toEqual({ ok: true, data: [] });
    expect(await searchWorkItems(client, { project: FAKE_PROJECT, query: '#00000' })).toEqual({ ok: true, data: [] });
    expect(fake.wiql.every((call) => !call.query.includes('[System.Id] ='))).toBe(true);
  });

  it('returns at most top items, 50 by default', async () => {
    const fake = installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    expect(ids(await searchWorkItems(client, { project: FAKE_PROJECT, query: 'Task' }))).toHaveLength(50);
    expect(ids(await searchWorkItems(client, { project: FAKE_PROJECT, query: 'Task', top: 7 }))).toHaveLength(7);
    expect(fake.wiql.map((call) => call.top)).toEqual([50, 7]);
  });

  it('returns nothing for a blank query, without a request', async () => {
    const fake = installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    expect(await searchWorkItems(client, { project: FAKE_PROJECT, query: '   ' })).toEqual({ ok: true, data: [] });
    expect(fake.requests).toBe(0);
  });

  it.each([
    ['a query over 256 characters', { project: FAKE_PROJECT, query: 'x'.repeat(257) }],
    ['a control character', { project: FAKE_PROJECT, query: 'job\u0000control' }],
    ['top above 200', { project: FAKE_PROJECT, query: 'job', top: 201 }],
    ['no project', { project: '', query: 'job' }],
  ])('refuses %s before sending anything', async (_case, options) => {
    const fake = installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    expect(await searchWorkItems(client, options)).toMatchObject({ ok: false, code: 'VALIDATION', details: { kind: 'config' } });
    expect(fake.requests).toBe(0);
  });
});

describe('getWorkItem', () => {
  it('reads one item with the ticket’s fields', async () => {
    const fake = installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    const result = await getWorkItem(client, { id: 71273 });

    expect(result).toEqual({ ok: true, data: ITEM_71273 });
    expect(fake.gets).toEqual([{ id: 71273, fields: [...WORK_ITEM_FIELDS] }]);
  });

  it("fails an unknown id with ADO's 404 and message", async () => {
    installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    const result = await getWorkItem(client, { id: 12345 });

    expect(result).toMatchObject({ ok: false, code: 'INTERNAL' });
    if (result.ok || !isAdoErrorDetails(result.details)) throw new Error('expected ADO error details');
    expect(result.details).toMatchObject({ kind: 'http', status: 404 });
    expect(result.details.adoMessage).toContain('TF401232');
  });

  it.each([0, -1, 1.5, Number.NaN, 2 ** 31])('refuses id %s before sending anything', async (id) => {
    const fake = installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    expect(await getWorkItem(client, { id })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(fake.requests).toBe(0);
  });
});

describe('getWorkItems', () => {
  it('reads many ids in pages of 200, in the order given, once each, leaving out missing ones', async () => {
    const fake = installFakeWorkItems(server, sprint42Backlog(450));
    const { client } = createTestClient();
    const wanted = [71341, 71273, 71341, 12345, ...Array.from({ length: 450 }, (_, i) => 80_450 - i)];

    const result = await getWorkItems(client, { ids: wanted });

    expect(ids(result)).toEqual([71341, 71273, ...Array.from({ length: 450 }, (_, i) => 80_450 - i)]);
    expect(fake.batches.map((batch) => batch.length)).toEqual([200, 200, 53]);
  });

  it('returns an empty list for no ids, without a request', async () => {
    const fake = installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    expect(await getWorkItems(client, { ids: [] })).toEqual({ ok: true, data: [] });
    expect(fake.requests).toBe(0);
  });
});

describe('state categories', () => {
  it.each([
    ['Proposed', 'proposed'],
    ['InProgress', 'in-progress'],
    ['In Progress', 'in-progress'],
    ['Resolved', 'resolved'],
    ['Completed', 'completed'],
    ['Removed', 'removed'],
    ['constructor', 'unknown'],
    ['', 'unknown'],
    [null, 'unknown'],
  ])('maps ADO category %j to %s', (category, expected) => {
    expect(toStateCategory(category)).toBe(expected);
  });

  it("reads each type's states once per client, sharing reads between concurrent calls", async () => {
    const fake = installFakeWorkItems(server, backlog());
    const { client } = createTestClient();

    await Promise.all([
      listSprintWorkItems(client, { project: FAKE_PROJECT, iterationPath: SPRINT_42 }),
      searchWorkItems(client, { project: FAKE_PROJECT, query: 'frmJobControl' }),
    ]);
    await getWorkItem(client, { id: 71330 });

    expect(fake.stateReads.sort()).toEqual([`${FAKE_PROJECT}/Bug`, `${FAKE_PROJECT}/Task`, `${FAKE_PROJECT}/User Story`]);

    // A new client (another org or a replaced PAT) reads them again.
    await getWorkItem(createTestClient().client, { id: 71330 });
    expect(fake.stateReads).toHaveLength(4);
  });

  it("reads a type's states again when an item is in a state the kept list lacks", async () => {
    const fake = installFakeWorkItems(server, backlog());
    const { client } = createTestClient();
    await getWorkItem(client, { id: 71330 });

    fake.states['Bug']!.push({ name: 'Blocked', category: 'InProgress' });
    fake.items.find((workItem) => workItem.id === 71330)!.state = 'Blocked';
    const result = await getWorkItem(client, { id: 71330 });

    expect(result).toMatchObject({ ok: true, data: { state: 'Blocked', stateCategory: 'in-progress' } });
    expect(fake.stateReads).toEqual([`${FAKE_PROJECT}/Bug`, `${FAKE_PROJECT}/Bug`]);
  });

  it('leaves items unknown when the states read fails, and tries again on the next call', async () => {
    const fake = installFakeWorkItems(server, backlog());
    let failing = true;
    server.use(
      http.get(`${ORG_URL}/:project/_apis/wit/workitemtypes/:type/states`, () => (failing ? HttpResponse.json({ message: 'down' }, { status: 500 }) : undefined)),
    );
    const { client } = createTestClient();

    const degraded = await getWorkItem(client, { id: 71273 });
    failing = false;
    const recovered = await getWorkItem(client, { id: 71273 });

    expect(degraded).toEqual({ ok: true, data: { ...ITEM_71273, stateCategory: 'unknown' } });
    expect(recovered).toEqual({ ok: true, data: ITEM_71273 });
    expect(fake.stateReads).toHaveLength(1);
  });

  it.each([
    [401, 'ADO_UNAUTHORIZED'],
    [403, 'ADO_SCOPE_MISSING'],
  ])('returns a %s from the states read as %s', async (status, code) => {
    installFakeWorkItems(server, backlog());
    server.use(http.get(`${ORG_URL}/:project/_apis/wit/workitemtypes/:type/states`, () => HttpResponse.json({}, { status })));
    const { client } = createTestClient();

    expect(await listSprintWorkItems(client, { project: FAKE_PROJECT, iterationPath: SPRINT_42 })).toMatchObject({ ok: false, code });
  });
});
