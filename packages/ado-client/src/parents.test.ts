import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { nearestPortfolioParent, projectIdOf } from './parents';
import { installFakeWorkItems, type FakeWorkItem } from './testing/fake-work-items';
import { createTestClient, ORG_URL, useMswServer } from './testing/msw-server';

const server = useMswServer();

function item(id: number, type: string, parentId?: number): FakeWorkItem {
  return {
    id,
    project: 'OnSite Companion',
    type,
    title: `${type} ${id}`,
    state: 'Active',
    iterationPath: 'OnSite Companion\\Sprint 42',
    changedDate: '2026-10-01T09:00:00Z',
    ...(parentId ? { parentId } : {}),
  };
}

const items = [
  item(47000, 'Epic'),
  item(48000, 'Feature', 47000),
  item(48162, 'User Story', 48000),
  item(48163, 'Task', 48162),
  item(48200, 'User Story', 47000),
  item(48300, 'Bug'),
  item(48400, 'User Story', 99999),
];

describe('nearestPortfolioParent (AL-290)', () => {
  it("gives a story's Feature, not the Epic above it", async () => {
    installFakeWorkItems(server, items);
    expect(await nearestPortfolioParent(createTestClient().client, { id: 48162 })).toEqual({ ok: true, data: { id: 48000, type: 'Feature', title: 'Feature 48000' } });
  });

  it('walks up from a task to the Feature', async () => {
    installFakeWorkItems(server, items);
    expect(await nearestPortfolioParent(createTestClient().client, { id: 48163 })).toMatchObject({ ok: true, data: { id: 48000 } });
  });

  it('gives the Epic when a story sits straight under one', async () => {
    installFakeWorkItems(server, items);
    expect(await nearestPortfolioParent(createTestClient().client, { id: 48200 })).toMatchObject({ ok: true, data: { id: 47000, type: 'Epic' } });
  });

  it('gives no room for an item with no parent, or a parent it cannot read', async () => {
    installFakeWorkItems(server, items);
    expect(await nearestPortfolioParent(createTestClient().client, { id: 48300 })).toEqual({ ok: true, data: null });
    expect(await nearestPortfolioParent(createTestClient().client, { id: 48400 })).toEqual({ ok: true, data: null });
  });

  it('fails when the item itself cannot be read, so the lookup is tried again later', async () => {
    installFakeWorkItems(server, items);
    expect((await nearestPortfolioParent(createTestClient().client, { id: 12345 })).ok).toBe(false);
  });
});

describe('projectIdOf (AL-298)', () => {
  it("reads the project's id by its name", async () => {
    server.use(
      http.get(`${ORG_URL}/_apis/projects/:project`, ({ params }) =>
        params['project'] === 'OnSite Companion' ? HttpResponse.json({ id: '6ce954b1-ce1f-45d1-b94d-e6bf2464ba2c', name: 'OnSite Companion' }) : HttpResponse.json({ message: 'TF200016: The project does not exist.' }, { status: 404 }),
      ),
    );
    const { client } = createTestClient();
    expect(await projectIdOf(client, ' OnSite Companion ')).toEqual({ ok: true, data: '6ce954b1-ce1f-45d1-b94d-e6bf2464ba2c' });
    expect(await projectIdOf(client, 'Nope')).toMatchObject({ ok: false });
  });
});
