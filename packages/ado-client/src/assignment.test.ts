import { describe, expect, it } from 'vitest';
import { getSignedInUser, getWorkItemAssignment, inProgressStateOf, setWorkItemAssignment } from './assignment';
import { createAdoClient } from './client';
import { createFakeTeamOrg, FAKE_TEAM_PROJECT, PEOPLE } from './testing/fake-team';

function setup() {
  const org = createFakeTeamOrg();
  const created = createAdoClient({ orgUrl: org.orgUrl, pat: org.pat, fetch: org.fetch, sleep: async () => undefined });
  if (!created.ok) throw new Error(created.message);
  return { org, client: created.data };
}

const ref = (workItemId: number) => ({ project: FAKE_TEAM_PROJECT, workItemId });

describe('assign to me and move to In Progress (AL-236)', () => {
  it('knows who the token signs in as, with the sign-in name an assignment takes', async () => {
    const { client } = setup();
    expect(await getSignedInUser(client)).toEqual({ ok: true, data: { id: PEOPLE.KR.id, displayName: 'Kyle Richards', uniqueName: PEOPLE.KR.uniqueName } });
  });

  it("finds the type's In Progress state", async () => {
    const { client } = setup();
    expect(await inProgressStateOf(client, FAKE_TEAM_PROJECT, 'Bug')).toEqual({ ok: true, data: 'Active' });
  });

  it('assigns and moves in one guarded revision, and puts it back the same way', async () => {
    const { client, org } = setup();
    const before = await getWorkItemAssignment(client, ref(71335));
    expect(before).toEqual({ ok: true, data: { workItemId: 71335, rev: 3, type: 'User Story', state: 'New', assignee: null } });

    const assigned = await setWorkItemAssignment(client, ref(71335), { expectedRev: 3, assignee: PEOPLE.KR.uniqueName, state: 'Active' });
    expect(assigned).toMatchObject({ ok: true, data: { rev: 4, state: 'Active', assignee: { displayName: 'Kyle Richards', uniqueName: PEOPLE.KR.uniqueName } } });
    expect(org.state.workItems.items.find((item) => item.id === 71335)).toMatchObject({ boardColumn: 'In Progress' });

    // Someone else changed it since revision 3: nothing is written.
    const stale = await setWorkItemAssignment(client, ref(71335), { expectedRev: 3, assignee: null, state: 'New' });
    expect(stale).toMatchObject({ ok: false, code: 'INTERNAL', details: { reason: 'changed' } });

    const restored = await setWorkItemAssignment(client, ref(71335), { expectedRev: 4, assignee: null, state: 'New' });
    expect(restored).toMatchObject({ ok: true, data: { state: 'New', assignee: null } });
    expect(org.state.workItems.items.find((item) => item.id === 71335)).toMatchObject({ state: 'New', boardColumn: 'To Do' });
  });
});
