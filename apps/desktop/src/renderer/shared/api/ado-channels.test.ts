import { formatPullRequestActivity } from '@agent-lanes/contracts';
import { ADO_FIXTURE_PROJECT, ADO_FIXTURE_REPOSITORY, ADO_FIXTURE_SPRINT_42_PATH, adoFixture } from '@agent-lanes/contracts/testing';
import { describe, expect, it } from 'vitest';
import { installFakeBridge } from '@/shared/testing';
import { invoke } from './ipc';

/**
 * AL-065, renderer side: the `ado:*` replies main sends (the shared fixture) pass the renderer's own
 * validation in `invoke`, so query hooks (AL-066) and UI tests can answer the fake bridge with them.
 */
const fixture = adoFixture();
const [snapshot] = fixture.pullRequests;

describe('ado:* through invoke', () => {
  it('validates and returns each channel’s fixture reply', async () => {
    installFakeBridge({
      'ado:listSprints': { ok: true, data: fixture.sprints },
      'ado:listWorkItems': { ok: true, data: fixture.workItems.slice(0, 4) },
      'ado:searchWorkItems': { ok: true, data: fixture.workItems.slice(0, 1) },
      'ado:getWorkItem': { ok: true, data: fixture.workItems[0] },
      'ado:getComments': { ok: true, data: fixture.comments[71273] },
      'ado:createPullRequest': { ok: true, data: { pullRequest: snapshot?.pullRequest, created: true } },
      'ado:getPullRequest': { ok: true, data: snapshot },
    });

    await expect(invoke('ado:listSprints', {})).resolves.toEqual({ ok: true, data: fixture.sprints });
    await expect(invoke('ado:listWorkItems', { iterationPath: ADO_FIXTURE_SPRINT_42_PATH })).resolves.toEqual({ ok: true, data: fixture.workItems.slice(0, 4) });
    await expect(invoke('ado:searchWorkItems', { query: '71273' })).resolves.toEqual({ ok: true, data: [fixture.workItems[0]] });
    await expect(invoke('ado:getWorkItem', { id: 71273 })).resolves.toEqual({ ok: true, data: fixture.workItems[0] });
    await expect(invoke('ado:getComments', { workItemId: 71273 })).resolves.toEqual({ ok: true, data: fixture.comments[71273] });
    await expect(
      invoke('ado:createPullRequest', {
        project: ADO_FIXTURE_PROJECT,
        repository: ADO_FIXTURE_REPOSITORY.name,
        sourceBranch: '71273-cutover-frmjobcontrol-to',
        targetBranch: 'main',
        title: 'Cutover frmJobControl to Blazor',
      }),
    ).resolves.toMatchObject({ ok: true, data: { created: true } });

    const pr = await invoke('ado:getPullRequest', { project: ADO_FIXTURE_PROJECT, repository: ADO_FIXTURE_REPOSITORY.name, pullRequestId: 10612 });
    expect(pr.ok && formatPullRequestActivity(pr.data.pullRequest, pr.data.checks)).toBe('PR !10612 · 3 / 4 checks');
  });

  it('turns a reply that breaks the DTO into INTERNAL, and passes ADO errors through', async () => {
    installFakeBridge({
      'ado:getWorkItem': { ok: true, data: { ...fixture.workItems[0], webUrl: 'javascript:alert(1)' } },
      'ado:listSprints': { ok: false, code: 'ADO_UNAUTHORIZED', message: 'No Azure DevOps organisation is connected.', details: { reason: 'not-connected' } },
    });
    await expect(invoke('ado:getWorkItem', { id: 71273 })).resolves.toMatchObject({ ok: false, code: 'INTERNAL' });
    await expect(invoke('ado:listSprints', {})).resolves.toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });
  });
});
