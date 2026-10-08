import { describe, expect, it } from 'vitest';
import { createAdoClient } from './client';
import { listOpenThreads } from './pr-threads';
import { createFakeTeamOrg, FAKE_TEAM_PROJECT, FAKE_TEAM_REPOSITORY } from './testing/fake-team';

function setup() {
  const org = createFakeTeamOrg();
  const created = createAdoClient({ orgUrl: org.orgUrl, pat: org.pat, fetch: org.fetch, sleep: async () => undefined });
  if (!created.ok) throw new Error(created.message);
  return { org, client: created.data };
}

describe('open comment threads of a pull request (AL-238)', () => {
  it('lists every unresolved thread with its file, line, author and text', async () => {
    const { client } = setup();
    const result = await listOpenThreads(client, { project: FAKE_TEAM_PROJECT, repositoryId: FAKE_TEAM_REPOSITORY.id, pullRequestId: 10571 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(6);
    expect(result.data[0]).toEqual({ id: 1, filePath: '/src/Jobs/JobNotes.razor', line: 10, author: 'Tom Young', text: 'Please rename this (1).', replies: 0 });
    expect(result.data[1]).toMatchObject({ id: 2, filePath: '/src/Jobs/JobNotesEditor.cs', line: 17 });
    // A thread about the whole PR has no file.
    expect(result.data[5]).toMatchObject({ id: 6, filePath: null, line: null });
  });

  it('leaves out resolved, closed, deleted and system threads', async () => {
    const { client } = setup();
    const result = await listOpenThreads(client, { project: FAKE_TEAM_PROJECT, repositoryId: FAKE_TEAM_REPOSITORY.id, pullRequestId: 10598 });
    expect(result.ok && result.data.map((thread) => thread.id)).toEqual([1, 2, 3, 4]);
  });
});
