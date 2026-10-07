import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADO_FIXTURE_PAT, createFakeAdoOrg, type FakeAdoOrg } from '@agent-lanes/ado-client/testing';
import type { FetchLike } from '@agent-lanes/ado-client';
import { formatPullRequestActivity } from '@agent-lanes/contracts';
import {
  ADO_FIXTURE_ORG_ID,
  ADO_FIXTURE_ORG_URL,
  ADO_FIXTURE_PROJECT,
  ADO_FIXTURE_REPOSITORY,
  ADO_FIXTURE_SPRINT_42_PATH,
  adoFixture,
} from '@agent-lanes/contracts/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createConnectionsService } from '../connections';
import { createMemoryConnectionsFile } from '../connections/connections-file';
import { SECRETS_FILE_NAME, createSecretStore, type SecretStore } from '../secrets';
import { createFakeSafeStorage } from '../secrets/testing';
import { createSettingsService } from '../settings/service';
import { createMemorySettingsFile } from '../settings/settings-file';
import { createAdoService } from './service';

/**
 * AL-065: AdoService against the shared fake organisation, with the real ConnectionsService and
 * SecretStore (fake safeStorage) holding the PATs. Nothing leaves the process.
 */

/** A second organisation, with its own PAT; made up, valid nowhere. */
const FABRIKAM_URL = 'https://dev.azure.com/fabrikam';
const FABRIKAM_PAT = 'fakepatAL065fabrikam000only1111never2222real3333zzK9';
const NEW_PAT = 'fakepatAL065replaced000only1111never2222real3333zzN2';
const ALL_PATS = [ADO_FIXTURE_PAT, FABRIKAM_PAT, NEW_PAT];

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-ado-service-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Sends each request to the fake organisation whose URL it starts with. */
function route(...orgs: FakeAdoOrg[]): FetchLike {
  return (input, init) => {
    const org = orgs.find((candidate) => input.startsWith(`${candidate.orgUrl}/`));
    return org ? org.fetch(input, init) : Promise.reject(new Error(`No fake organisation for ${input}`));
  };
}

async function setup(options: { orgs?: FakeAdoOrg[]; stateTransitions?: boolean } = {}) {
  const contoso = createFakeAdoOrg();
  const orgs = options.orgs ?? [contoso];
  const secrets: SecretStore = createSecretStore({
    filePath: join(dir, SECRETS_FILE_NAME),
    safeStorage: createFakeSafeStorage({ key: randomBytes(32) }),
    warn: () => undefined,
  });
  const connections = createConnectionsService({ file: createMemoryConnectionsFile(), secrets, emit: () => undefined, warn: () => undefined });
  const settings = createSettingsService({
    file: createMemorySettingsFile(options.stateTransitions ? { version: 2, adoStateTransitions: true } : undefined),
    warn: () => undefined,
  });
  const log = { log: vi.fn() };
  const fetch = vi.fn(route(...orgs));
  const ado = createAdoService({ connections, settings, fetch, log });
  return { ado, connections, secrets, settings, log, fetch, contoso };
}

async function connectContoso(connections: Awaited<ReturnType<typeof setup>>['connections'], pat = ADO_FIXTURE_PAT, defaultProject: string | null = ADO_FIXTURE_PROJECT) {
  const saved = await connections.save({ kind: 'ado', orgUrl: ADO_FIXTURE_ORG_URL, pat, defaultProject });
  if (!saved.ok) throw new Error(saved.message);
  expect(saved.data.id).toBe(ADO_FIXTURE_ORG_ID);
}

describe('AdoService reads', () => {
  it('serves every read from the organisation’s client and its default project, exactly as the fixture', async () => {
    const { ado, connections, contoso } = await setup();
    await connectContoso(connections);
    const fixture = adoFixture();

    expect(await ado.listSprints({})).toEqual({ ok: true, data: fixture.sprints });
    expect(await ado.listWorkItems({ iterationPath: ADO_FIXTURE_SPRINT_42_PATH })).toEqual({ ok: true, data: fixture.workItems.slice(0, 4) });
    expect(await ado.searchWorkItems({ query: 'frmJobControl' })).toEqual({ ok: true, data: [fixture.workItems[0]] });
    expect(await ado.getWorkItem({ id: 71273 })).toEqual({ ok: true, data: fixture.workItems[0] });
    expect(await ado.getComments({ workItemId: 71273 })).toEqual({ ok: true, data: fixture.comments[71273] });

    const snapshot = await ado.getPullRequest({ project: ADO_FIXTURE_PROJECT, repository: ADO_FIXTURE_REPOSITORY.name, pullRequestId: 10612 });
    expect(snapshot).toEqual({ ok: true, data: fixture.pullRequests[0] });
    expect(snapshot.ok && formatPullRequestActivity(snapshot.data.pullRequest, snapshot.data.checks)).toBe('PR !10612 · 3 / 4 checks');

    expect(contoso.state.unhandled).toEqual([]);
    expect(contoso.state.requests.every((request) => request.authorized)).toBe(true);
  });

  it('creates a pull request linked to its work item, and reuses it when asked again', async () => {
    const { ado, connections, contoso } = await setup();
    await connectContoso(connections);
    const request = {
      project: ADO_FIXTURE_PROJECT,
      repository: ADO_FIXTURE_REPOSITORY.name,
      sourceBranch: '71330-asset-register-paging',
      targetBranch: 'main',
      title: 'Asset register paging slow above 5k rows',
      workItemIds: [71330],
    };

    expect(await ado.createPullRequest(request)).toMatchObject({ ok: true, data: { created: true, pullRequest: { id: 10613, workItemIds: [71330] } } });
    expect(await ado.createPullRequest({ ...request, org: ADO_FIXTURE_ORG_ID })).toMatchObject({ ok: true, data: { created: false, pullRequest: { id: 10613 } } });
    expect(contoso.state.pullRequests.map((entry) => entry.pullRequest.id)).toEqual([10612, 10613]);
  });

  it('a request’s own project wins over the default; without either it asks for one, except for reads by id', async () => {
    const { ado, connections } = await setup();
    await connectContoso(connections, ADO_FIXTURE_PAT, null);

    expect(await ado.listSprints({})).toMatchObject({ ok: false, code: 'VALIDATION', details: { org: ADO_FIXTURE_ORG_ID, reason: 'no-project' } });
    expect(await ado.getComments({ workItemId: 71273 })).toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'no-project' } });
    expect(await ado.listSprints({ project: ADO_FIXTURE_PROJECT })).toMatchObject({ ok: true, data: { currentId: adoFixture().sprints.currentId } });
    expect(await ado.getWorkItem({ id: 71273 })).toMatchObject({ ok: true, data: { id: 71273 } });
    expect(await ado.listSprints({ project: 'Other Project' })).toMatchObject({ ok: false, details: { status: 404 } });
  });
});

describe('AdoService picks the client per organisation', () => {
  it('sends each organisation its own PAT; no org means the first connected one', async () => {
    const contoso = createFakeAdoOrg();
    const fabrikamFixture = adoFixture(FABRIKAM_URL);
    fabrikamFixture.workItems[0]!.title = 'Fabrikam: Cutover frmJobControl to Blazor';
    const fabrikam = createFakeAdoOrg({ orgUrl: FABRIKAM_URL, pat: FABRIKAM_PAT, fixture: fabrikamFixture });
    const { ado, connections } = await setup({ orgs: [contoso, fabrikam] });
    // Saved second, listed first: connections:list orders organisations by name.
    const saved = await connections.save({ kind: 'ado', orgUrl: FABRIKAM_URL, pat: FABRIKAM_PAT, defaultProject: ADO_FIXTURE_PROJECT });
    expect(saved).toMatchObject({ ok: true, data: { id: 'ado:fabrikam' } });
    await connectContoso(connections);

    expect(await ado.getWorkItem({ org: 'ado:fabrikam', id: 71273 })).toMatchObject({ ok: true, data: { title: 'Fabrikam: Cutover frmJobControl to Blazor', webUrl: `${FABRIKAM_URL}/OnSite%20Companion/_workitems/edit/71273` } });
    expect(await ado.getWorkItem({ org: ADO_FIXTURE_ORG_ID, id: 71273 })).toMatchObject({ ok: true, data: { title: 'Cutover frmJobControl to Blazor' } });
    expect(await ado.getWorkItem({ id: 71273 })).toMatchObject({ ok: true, data: { title: 'Cutover frmJobControl to Blazor' } });

    // Each organisation saw only its own, correctly authorised requests.
    expect(contoso.state.requests.length).toBeGreaterThan(0);
    expect(fabrikam.state.requests.length).toBeGreaterThan(0);
    expect([...contoso.state.requests, ...fabrikam.state.requests].every((request) => request.authorized)).toBe(true);
  });

  it('keeps one client per organisation, so state categories are read once, and rebuilds it when the token is replaced', async () => {
    const { ado, connections, contoso } = await setup();
    await connectContoso(connections);

    const first = await ado.clientFor(ADO_FIXTURE_ORG_ID);
    const again = await ado.clientFor();
    expect(first.ok && again.ok && first.data === again.data).toBe(true);
    await ado.listWorkItems({ iterationPath: ADO_FIXTURE_SPRINT_42_PATH });
    const stateReads = contoso.state.workItems.stateReads.length;
    await ado.listWorkItems({ iterationPath: ADO_FIXTURE_SPRINT_42_PATH });
    expect(contoso.state.workItems.stateReads.length).toBe(stateReads);

    const replaced = await connections.replace({ id: ADO_FIXTURE_ORG_ID, draft: { kind: 'ado', orgUrl: ADO_FIXTURE_ORG_URL, pat: NEW_PAT } });
    expect(replaced.ok).toBe(true);
    const second = await ado.clientFor(ADO_FIXTURE_ORG_ID);
    expect(second.ok && first.ok && second.data !== first.data).toBe(true);
    // The fake organisation accepts only the fixture PAT, so the new token is what went out.
    expect(await ado.getWorkItem({ id: 71273 })).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });
    expect(contoso.state.requests.at(-1)).toMatchObject({ authorized: false });
  });

  it('says ADO_UNAUTHORIZED, with the reason, when there is no usable connection', async () => {
    const { ado, connections, secrets, fetch } = await setup();
    expect(await ado.listSprints({})).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED', details: { reason: 'not-connected' } });

    await connectContoso(connections);
    expect(await ado.getWorkItem({ org: 'ado:fabrikam', id: 71273 })).toMatchObject({
      ok: false,
      code: 'ADO_UNAUTHORIZED',
      details: { reason: 'not-connected', org: 'ado:fabrikam' },
    });

    // The token is gone from the SecretStore (say a corrupt secrets file): reconnect.
    await secrets.delete(ADO_FIXTURE_ORG_ID);
    expect(await ado.getWorkItem({ id: 71273 })).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED', details: { reason: 'reconnect', org: ADO_FIXTURE_ORG_ID } });

    await connections.remove(ADO_FIXTURE_ORG_ID);
    expect(await ado.getWorkItem({ org: ADO_FIXTURE_ORG_ID, id: 71273 })).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED', details: { reason: 'not-connected' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes ADO’s own 401 through as ADO_UNAUTHORIZED', async () => {
    const { ado, connections } = await setup();
    await connectContoso(connections, 'fakepatAL065wrong00000only1111never2222real3333zzW1');
    expect(await ado.listSprints({})).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });
  });

  it('hands every answer to the connection, so its scope checks learn from real calls (AL-043)', async () => {
    const { connections } = await setup();
    await connectContoso(connections);
    const noteAdoResponse = vi.spyOn(connections, 'noteAdoResponse');
    const ado = createAdoService({ connections, settings: createSettingsService({ file: createMemorySettingsFile(), warn: () => undefined }), fetch: route(createFakeAdoOrg()) });

    expect(await ado.getWorkItem({ id: 71273 })).toMatchObject({ ok: true });
    expect(noteAdoResponse).toHaveBeenCalledWith(ADO_FIXTURE_ORG_ID, expect.objectContaining({ method: 'GET', status: 200 }));
  });
});

describe('AdoService write-back (AL-063) through the same clients', () => {
  it('posts comments; state changes only while ADO state transitions is on', async () => {
    const off = await setup();
    await connectContoso(off.connections);
    const target = { org: ADO_FIXTURE_ORG_ID, project: ADO_FIXTURE_PROJECT, workItemId: 71330 };

    expect(await off.ado.writeBack.comment(target, 'Planning')).toMatchObject({ ok: true, data: { text: 'Agent Lanes · Planning', fromAgentLanes: true } });
    expect(await off.ado.getComments({ workItemId: 71330 })).toMatchObject({ ok: true, data: [{ text: 'Agent Lanes · Planning' }] });
    expect(await off.ado.writeBack.setState(target, 'Active')).toEqual({ ok: true, data: { outcome: 'disabled', workItemId: 71330 } });
    expect(off.contoso.state.workItems.items.find((item) => item.id === 71330)?.state).toBe('New');

    const on = await setup({ stateTransitions: true });
    await connectContoso(on.connections);
    expect(await on.ado.writeBack.setState(target, 'Active')).toMatchObject({ ok: true, data: { outcome: 'changed', state: 'Active', previousState: 'New' } });
    expect(await on.ado.getWorkItem({ id: 71330 })).toMatchObject({ ok: true, data: { state: 'Active', stateCategory: 'in-progress' } });
  });
});

describe('AdoService never leaks a PAT', () => {
  it('keeps every token out of results, errors and log lines', async () => {
    const { ado, connections, log } = await setup();
    await connectContoso(connections);
    const results = [
      await ado.listSprints({}),
      await ado.listWorkItems({ iterationPath: ADO_FIXTURE_SPRINT_42_PATH }),
      await ado.getWorkItem({ id: 99999 }),
      await ado.getPullRequest({ project: ADO_FIXTURE_PROJECT, repository: 'nope', pullRequestId: 1 }),
    ];
    await connections.replace({ id: ADO_FIXTURE_ORG_ID, draft: { kind: 'ado', orgUrl: ADO_FIXTURE_ORG_URL, pat: NEW_PAT } });
    results.push(await ado.listSprints({}));

    expect(results.filter((result) => !result.ok)).toHaveLength(3);
    expect(log.log).toHaveBeenCalled();
    const everything = JSON.stringify({ results, log: log.log.mock.calls });
    for (const pat of ALL_PATS) {
      expect(everything).not.toContain(pat);
      expect(everything).not.toContain(btoa(`:${pat}`));
    }
  });
});
