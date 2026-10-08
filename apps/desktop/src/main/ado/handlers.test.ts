import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADO_FIXTURE_PAT, createFakeAdoOrg } from '@agent-lanes/ado-client/testing';
import { ADO_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import {
  ADO_FIXTURE_ORG_ID,
  ADO_FIXTURE_ORG_URL,
  ADO_FIXTURE_PROJECT,
  ADO_FIXTURE_PROJECT_ID,
  ADO_FIXTURE_REPOSITORY,
  ADO_FIXTURE_SPRINT_42_PATH,
  ADO_FIXTURE_TEAM,
  adoFixture,
} from '@agent-lanes/contracts/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnectionsService } from '../connections';
import { createMemoryConnectionsFile } from '../connections/connections-file';
import { handleInvoke } from '../ipc/handle-invoke';
import { SECRETS_FILE_NAME, createSecretStore } from '../secrets';
import { createFakeSafeStorage } from '../secrets/testing';
import { createSettingsService } from '../settings/service';
import { createMemorySettingsFile } from '../settings/settings-file';
import { createAdoHandlers } from './handlers';
import { createAdoService } from './service';

/**
 * AL-065 acceptance: every `ado:*` channel through `handleInvoke` (request contract, handler,
 * response contract), against the shared fake organisation with a PAT saved through Connections.
 */

type AdoChannel = (typeof ADO_INVOKE_CHANNELS)[number];

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-ado-ipc-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function setup(options: { connect?: boolean } = {}) {
  const org = createFakeAdoOrg();
  const secrets = createSecretStore({ filePath: join(dir, SECRETS_FILE_NAME), safeStorage: createFakeSafeStorage({ key: randomBytes(32) }), warn: () => undefined });
  const connections = createConnectionsService({ file: createMemoryConnectionsFile(), secrets, emit: () => undefined, warn: () => undefined });
  if (options.connect !== false) {
    const saved = await connections.save({ kind: 'ado', orgUrl: ADO_FIXTURE_ORG_URL, pat: ADO_FIXTURE_PAT, defaultProject: ADO_FIXTURE_PROJECT });
    if (!saved.ok) throw new Error(saved.message);
  }
  const settings = createSettingsService({ file: createMemorySettingsFile(), warn: () => undefined });
  const fetch = vi.fn(org.fetch);
  const handlers = createAdoHandlers(createAdoService({ connections, settings, fetch }));
  const call = <C extends AdoChannel>(channel: C, request: unknown) => handleInvoke(channel, request, handlers[channel]);
  return { org, handlers, call, fetch };
}

const fixture = adoFixture();
const PR_REF = { project: ADO_FIXTURE_PROJECT, repository: ADO_FIXTURE_REPOSITORY.name, pullRequestId: 10612 };

describe('ado:* IPC handlers', () => {
  it('has a handler for every ado channel', async () => {
    const { handlers } = await setup();
    expect(Object.keys(handlers).sort()).toEqual([...ADO_INVOKE_CHANNELS].sort());
  });

  it('ado:listSprints returns the team’s sprints with Sprint 42 current', async () => {
    const { call } = await setup();
    expect(await call('ado:listSprints', {})).toEqual({ ok: true, data: fixture.sprints });
    expect(await call('ado:listSprints', { org: ADO_FIXTURE_ORG_ID, project: ADO_FIXTURE_PROJECT, team: ADO_FIXTURE_TEAM })).toEqual({ ok: true, data: fixture.sprints });
  });

  it('ado:listWorkItems returns Sprint 42’s four items', async () => {
    const { call } = await setup();
    expect(await call('ado:listWorkItems', { iterationPath: ADO_FIXTURE_SPRINT_42_PATH })).toEqual({ ok: true, data: fixture.workItems.slice(0, 4) });
  });

  it('ado:searchWorkItems finds #71273 by id or title', async () => {
    const { call } = await setup();
    expect(await call('ado:searchWorkItems', { query: '#71273' })).toEqual({ ok: true, data: [fixture.workItems[0]] });
    expect(await call('ado:searchWorkItems', { query: 'frmJobControl', top: 5 })).toEqual({ ok: true, data: [fixture.workItems[0]] });
    expect(await call('ado:searchWorkItems', { query: '   ' })).toEqual({ ok: true, data: [] });
  });

  it('ado:getWorkItem returns one item', async () => {
    const { call } = await setup();
    expect(await call('ado:getWorkItem', { id: 71341 })).toEqual({ ok: true, data: fixture.workItems[3] });
    expect(await call('ado:getWorkItem', { id: 99999 })).toMatchObject({ ok: false, code: 'INTERNAL', details: { status: 404 } });
  });

  it('ado:getComments returns the discussion, the app’s own comments marked', async () => {
    const { call } = await setup();
    expect(await call('ado:getComments', { project: ADO_FIXTURE_PROJECT, workItemId: 71273 })).toEqual({ ok: true, data: fixture.comments[71273] });
  });

  it('ado:createPullRequest opens and links a PR, then reuses it', async () => {
    const { call, org } = await setup();
    const request = {
      project: ADO_FIXTURE_PROJECT,
      repository: ADO_FIXTURE_REPOSITORY.name,
      sourceBranch: 'refs/heads/71335-defect-photos-inline',
      targetBranch: 'main',
      title: 'Client portal: show defect photos inline',
      description: 'Shows defect photos inline.',
      workItemIds: [71335],
    };
    const created = await call('ado:createPullRequest', request);
    expect(created).toMatchObject({
      ok: true,
      data: { created: true, pullRequest: { id: 10613, sourceBranch: '71335-defect-photos-inline', targetBranch: 'main', workItemIds: [71335], status: 'active' } },
    });
    expect(await call('ado:createPullRequest', request)).toMatchObject({ ok: true, data: { created: false, pullRequest: { id: 10613 } } });
    expect(org.state.pullRequests).toHaveLength(2);
  });

  it('ado:getPullRequest returns the PR and its checks, by name or by GUIDs', async () => {
    const { call } = await setup();
    expect(await call('ado:getPullRequest', PR_REF)).toEqual({ ok: true, data: fixture.pullRequests[0] });
    expect(
      await call('ado:getPullRequest', { org: ADO_FIXTURE_ORG_ID, project: ADO_FIXTURE_PROJECT_ID, repository: ADO_FIXTURE_REPOSITORY.id, pullRequestId: 10612 }),
    ).toEqual({ ok: true, data: fixture.pullRequests[0] });
  });

  it.each<[AdoChannel, unknown]>([
    ['ado:listSprints', undefined],
    ['ado:listSprints', { org: 'claude' }],
    ['ado:listWorkItems', { iterationPath: '' }],
    ['ado:searchWorkItems', { query: 'x'.repeat(300) }],
    ['ado:getWorkItem', { id: -1 }],
    ['ado:getComments', { workItemId: 71273, pat: ADO_FIXTURE_PAT }],
    ['ado:createPullRequest', { ...PR_REF, sourceBranch: 'main', targetBranch: 'main', title: 'x' }],
    ['ado:getPullRequest', { project: ADO_FIXTURE_PROJECT, repository: ADO_FIXTURE_REPOSITORY.name }],
  ])('%s refuses %j before anything reaches Azure DevOps', async (channel, request) => {
    const { call, fetch } = await setup();
    const result = await call(channel, request);
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(ADO_FIXTURE_PAT);
  });

  it('answers every channel with ADO_UNAUTHORIZED, not a throw, when no organisation is connected', async () => {
    const { call, fetch } = await setup({ connect: false });
    const requests: Record<AdoChannel, unknown> = {
      'ado:listSprints': {},
      'ado:listWorkItems': { iterationPath: ADO_FIXTURE_SPRINT_42_PATH },
      'ado:searchWorkItems': { query: '71273' },
      'ado:getWorkItem': { id: 71273 },
      'ado:getComments': { workItemId: 71273 },
      'ado:createPullRequest': { ...PR_REF, sourceBranch: 'a', targetBranch: 'main', title: 'x' },
      'ado:getPullRequest': PR_REF,
      'ado:listTeams': {},
      'ado:teamBoard': {},
    };
    for (const channel of ADO_INVOKE_CHANNELS) {
      expect(await call(channel, requests[channel])).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED', details: { reason: 'not-connected' } });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});
