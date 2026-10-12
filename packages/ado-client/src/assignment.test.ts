import { describe, expect, it } from 'vitest';
import { assigneeValues, getSignedInUser, getWorkItemAssignment, inProgressStateOf, isUnknownIdentity, setWorkItemAssignment, signInName } from './assignment';
import { createAdoClient } from './client';
import { ON_PREM_IDENTITY, createFakeTeamOrg, FAKE_TEAM_PROJECT, PEOPLE, type FakeTeamOrgOptions } from './testing/fake-team';

function setup(options: FakeTeamOrgOptions = {}) {
  const org = createFakeTeamOrg(options);
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

describe('assigning on Azure DevOps Server (Windows identities)', () => {
  it('builds the sign-in name from the account and domain, and leaves emails and tenant ids alone', () => {
    expect(signInName('Kyle.Richards', 'COMPANION')).toBe('COMPANION\\Kyle.Richards');
    expect(signInName('kyle.richards@example.com', 'COMPANION')).toBe('kyle.richards@example.com');
    expect(signInName('kyle@example.com', '72f988bf-86f1-41af-91ab-2d7cd011db47')).toBe('kyle@example.com');
    expect(signInName('COMPANION\\Kyle.Richards', 'COMPANION')).toBe('COMPANION\\Kyle.Richards');
    expect(signInName('Kyle.Richards', null)).toBe('Kyle.Richards');
    expect(signInName('  ', 'COMPANION')).toBeNull();
    expect(assigneeValues({ id: 'id-1', displayName: 'Kyle Richards', uniqueName: 'COMPANION\\Kyle.Richards' })).toEqual(['COMPANION\\Kyle.Richards', 'id-1', 'Kyle Richards']);
    expect(assigneeValues({ id: null, displayName: 'Kyle Richards', uniqueName: null })).toEqual(['Kyle Richards']);
  });

  it('reads the domain account from connectionData and, when the server does not know it, assigns by identity id', async () => {
    const { client, org } = setup({ identities: 'on-prem' });
    const me = await getSignedInUser(client);
    expect(me).toEqual({ ok: true, data: { id: PEOPLE.KR.id, displayName: 'Kyle Richards', uniqueName: `${ON_PREM_IDENTITY.domain}\\${ON_PREM_IDENTITY.account}` } });
    if (!me.ok) throw new Error(me.message);

    const assigned = await setWorkItemAssignment(client, ref(71335), { expectedRev: 3, assignee: me.data, state: 'Active' });
    expect(assigned).toMatchObject({ ok: true, data: { rev: 4, state: 'Active', assignee: { displayName: 'Kyle Richards' } } });
    expect(org.state.refusedAssignees).toEqual([`${ON_PREM_IDENTITY.domain}\\${ON_PREM_IDENTITY.account}`]);
    expect(org.state.workItems.items.find((item) => item.id === 71335)).toMatchObject({ assignedTo: PEOPLE.KR, boardColumn: 'In Progress' });

    // A bare string is tried once and refused as before; a person nobody knows fails with the last refusal.
    const bare = await setWorkItemAssignment(client, ref(71335), { expectedRev: 4, assignee: 'Kyle.Richards', state: 'Active' });
    expect(bare.ok).toBe(false);
    expect(isUnknownIdentity(bare)).toBe(true);
    const nobody = await setWorkItemAssignment(client, ref(71335), { expectedRev: 4, assignee: { id: 'ghost', displayName: 'Ghost', uniqueName: 'COMPANION\\ghost' }, state: 'Active' });
    expect(nobody.ok).toBe(false);
    expect(org.state.refusedAssignees.slice(1)).toEqual(['Kyle.Richards', 'COMPANION\\ghost', 'ghost', 'Ghost']);
    expect(org.state.workItems.items.find((item) => item.id === 71335)?.rev).toBe(4);
  });
});
