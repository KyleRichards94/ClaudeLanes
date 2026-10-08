import { WorkItemColorsSchema, workItemStateColor, workItemTypeColor } from '@agent-lanes/contracts';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { FAKE_PROJECT, installFakeWorkItems } from './testing/fake-work-items';
import { createTestClient, ORG_URL, useMswServer } from './testing/msw-server';
import { adoColor, getWorkItemColors } from './work-item-colors';

const server = useMswServer();

describe('adoColor', () => {
  it.each([
    ['CC293D', '#CC293D'],
    ['ffcc293d', '#CC293D'],
    ['#009ccc', '#009CCC'],
    ['b2b2b2', '#B2B2B2'],
  ])('reads %j as %s', (raw, expected) => {
    expect(adoColor(raw)).toBe(expected);
  });

  it.each([null, undefined, '', 'red', '12345', 'GG0000'])('drops %j', (raw) => {
    expect(adoColor(raw)).toBeNull();
  });
});

describe('getWorkItemColors', () => {
  it("reads each type's colour and its states' colours, as ADO's boards show them", async () => {
    const fake = installFakeWorkItems(server, []);
    const { client } = createTestClient();

    const result = await getWorkItemColors(client, { project: FAKE_PROJECT });
    if (!result.ok) throw new Error(result.message);

    expect(WorkItemColorsSchema.parse(result.data)).toEqual(result.data);
    expect(result.data.types).toEqual({ 'User Story': '#009CCC', Bug: '#CC293D', Task: '#F2CB1D', Epic: '#FF7B00', Feature: '#773B93' });
    expect(result.data.states['Bug']).toEqual({ New: '#B2B2B2', Active: '#007ACC', Resolved: '#FF9D00', Closed: '#339933' });
    expect(workItemTypeColor(result.data, 'user story')).toBe('#009CCC');
    expect(workItemStateColor(result.data, 'Bug', 'closed')).toBe('#339933');
    expect(workItemStateColor(result.data, 'Bug', 'Failed UAT')).toBeNull();

    // Task came without its states in the list, so they were read from its states route; no other type was.
    expect(result.data.states['Task']).toEqual({ New: '#B2B2B2', Active: '#007ACC', Closed: '#339933', Removed: '#FFFFFF' });
    expect(fake.typeReads).toEqual([FAKE_PROJECT]);
    expect(fake.stateReads).toEqual([`${FAKE_PROJECT}/Task`]);
  });

  it('leaves out disabled types and colours it cannot read', async () => {
    server.use(
      http.get(`${ORG_URL}/:project/_apis/wit/workitemtypes`, () =>
        HttpResponse.json({
          count: 3,
          value: [
            { name: 'Bug', color: 'not-a-colour', states: [{ name: 'Active', color: '007acc' }, { name: 'Odd', color: null }] },
            { name: 'Old Type', color: 'FF000000', isDisabled: true, states: [] },
            { name: 'Issue', color: 'B4009E' },
          ],
        }),
      ),
      http.get(`${ORG_URL}/:project/_apis/wit/workitemtypes/:type/states`, () => HttpResponse.json({ message: 'Nope' }, { status: 500 })),
    );
    const { client } = createTestClient();

    const result = await getWorkItemColors(client, { project: FAKE_PROJECT, timeoutMs: 1_000 });
    expect(result).toEqual({ ok: true, data: { types: { Issue: '#B4009E' }, states: { Bug: { Active: '#007ACC' } } } });
  });

  it('fails as a Result when the type list cannot be read', async () => {
    server.use(http.get(`${ORG_URL}/:project/_apis/wit/workitemtypes`, () => HttpResponse.json({ message: 'TF400813: Not authorized' }, { status: 401 })));
    const { client } = createTestClient();

    const result = await getWorkItemColors(client, { project: FAKE_PROJECT });
    expect(result.ok).toBe(false);
  });

  it('needs a project', async () => {
    const { client } = createTestClient();
    expect(await getWorkItemColors(client, { project: ' ' })).toMatchObject({ ok: false, code: 'VALIDATION' });
  });
});
