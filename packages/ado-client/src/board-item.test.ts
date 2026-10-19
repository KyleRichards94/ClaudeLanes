import { describe, expect, it } from 'vitest';
import { listTeamMembers, updateBoardItem } from './board-item';
import { createAdoClient } from './client';
import { FAKE_TEAM_PROJECT, OSC_DEVELOPERS, PEOPLE, createFakeTeamOrg } from './testing/fake-team';

function setup() {
  const org = createFakeTeamOrg();
  const created = createAdoClient({ orgUrl: org.orgUrl, pat: org.pat, fetch: org.fetch, sleep: async () => undefined });
  if (!created.ok) throw new Error(created.message);
  return { org, client: created.data };
}

const person = (who: (typeof PEOPLE)[keyof typeof PEOPLE]) => ({ id: who.id, displayName: who.displayName, uniqueName: who.uniqueName });

describe('team board item edits (AL-285)', () => {
  it('lists the team’s people by name', async () => {
    const { client } = setup();
    const listed = await listTeamMembers(client, { project: FAKE_TEAM_PROJECT, team: OSC_DEVELOPERS.id });
    expect(listed).toEqual({
      ok: true,
      data: {
        team: { id: OSC_DEVELOPERS.id, name: OSC_DEVELOPERS.name },
        members: [person(PEOPLE.KR), person(PEOPLE.MD), person(PEOPLE.RJ), person(PEOPLE.TY)].map((member) => ({
          ...member,
          initials: member.displayName.split(' ').map((word) => word[0]).join(''),
        })),
      },
    });
  });

  it('moves a card to a column and assigns it in one revision', async () => {
    const { client, org } = setup();
    const updated = await updateBoardItem(client, {
      project: FAKE_TEAM_PROJECT,
      team: OSC_DEVELOPERS.id,
      workItemId: 71341,
      assignee: person(PEOPLE.KR),
      columnId: 'c-progress',
    });
    expect(updated).toMatchObject({
      ok: true,
      data: { workItemId: 71341, state: 'Active', assignee: person(PEOPLE.KR), columnId: 'c-progress', column: 'In Progress' },
    });
    expect(org.state.workItems.items.find((item) => item.id === 71341)).toMatchObject({ state: 'Active', boardColumn: 'In Progress', assignedTo: PEOPLE.KR });
  });

  it('moves a card between columns that share a state, and can clear the assignee', async () => {
    const { client, org } = setup();
    const across = await updateBoardItem(client, { project: FAKE_TEAM_PROJECT, team: OSC_DEVELOPERS.id, workItemId: 71352, columnId: 'Code Review' });
    expect(across).toMatchObject({ ok: true, data: { state: 'Active', column: 'Code Review', assignee: { displayName: 'Ravi Joshi' } } });
    expect(org.state.workItems.items.find((item) => item.id === 71352)?.boardColumn).toBe('Code Review');

    const moved = await updateBoardItem(client, { project: FAKE_TEAM_PROJECT, team: OSC_DEVELOPERS.name, workItemId: 71318, columnId: 'c-testing' });
    expect(moved).toMatchObject({ ok: true, data: { state: 'Resolved', column: 'Testing', assignee: { displayName: 'Kyle Richards' } } });
    expect(org.state.workItems.items.find((item) => item.id === 71318)?.boardColumn).toBe('Testing');

    const cleared = await updateBoardItem(client, { project: FAKE_TEAM_PROJECT, team: OSC_DEVELOPERS.id, workItemId: 71318, assignee: null });
    expect(cleared).toMatchObject({ ok: true, data: { assignee: null, column: null } });
    expect(org.state.workItems.items.find((item) => item.id === 71318)?.assignedTo).toBeUndefined();
  });

  it('refuses a column the board does not have, and a column with no state for the type', async () => {
    const { client } = setup();
    expect(await updateBoardItem(client, { project: FAKE_TEAM_PROJECT, team: OSC_DEVELOPERS.id, workItemId: 71318, columnId: 'missing' })).toMatchObject({
      ok: false,
      code: 'VALIDATION',
    });
    expect(await updateBoardItem(client, { project: FAKE_TEAM_PROJECT, team: OSC_DEVELOPERS.id, workItemId: 80010, columnId: 'c-testing' })).toMatchObject({
      ok: false,
      code: 'VALIDATION',
      message: expect.stringContaining('Task'),
    });
  });
});
