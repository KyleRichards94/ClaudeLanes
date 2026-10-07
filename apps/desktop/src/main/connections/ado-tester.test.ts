import { describe, expect, it, vi } from 'vitest';
import { CONNECTION_DATA_API_VERSION, createAdoConnectionTester } from './ado-tester';

/** Made up for the test; valid nowhere. */
const PAT = 'fakepat0000test1111only2222never3333real4444abcd7Fq2';
const ORG_URL = 'https://dev.azure.com/CompanionSystems';
const draft = { kind: 'ado', orgUrl: ORG_URL, pat: PAT } as const;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const connectionData = {
  authenticatedUser: { id: '6c3a2b1e-0000-4000-8000-000000000001', providerDisplayName: 'Kyle Richards', properties: {} },
  authorizedUser: { id: '6c3a2b1e-0000-4000-8000-000000000001', providerDisplayName: 'Kyle Richards' },
  instanceId: '00000000-0000-4000-8000-000000000002',
};

const TF400813 = { message: 'TF400813: The user is not authorized to access this resource.' };

type Area = 'connectionData' | 'projects' | 'wit' | 'git' | 'build';

function areaOf(url: string): Area | undefined {
  const { pathname } = new URL(url);
  if (pathname.endsWith('/_apis/connectionData')) return 'connectionData';
  if (pathname.endsWith('/_apis/projects')) return 'projects';
  return /\/_apis\/(wit|git|build)\//.exec(pathname)?.[1] as Area | undefined;
}

/**
 * A fake Azure DevOps organisation behind `fetch`: connectionData, one page of projects and the
 * three scope probes, each answering 200 unless `answers` gives another status for its area.
 */
function fakeAdo(answers: Partial<Record<Area, number>> = {}) {
  return vi.fn(async (url: string, _init: RequestInit): Promise<Response> => {
    const area = areaOf(url);
    const status = area ? (answers[area] ?? 200) : 404;
    if (status !== 200) return json(status, TF400813);
    switch (area) {
      case 'connectionData':
        return json(200, connectionData);
      case 'projects':
        return json(200, { count: 2, value: [{ name: 'OnSite Companion' }, { name: 'Hicora' }] });
      case 'wit':
        return json(200, { workItems: [] });
      default:
        return json(200, { count: 0, value: [] });
    }
  });
}

describe('ADO connection tester (AL-043)', () => {
  it('signs in with the PAT, loads the projects and checks each scope', async () => {
    const fetch = fakeAdo();
    const test = createAdoConnectionTester({ fetch });

    await expect(test({ ...draft, defaultProject: 'OnSite Companion' }, new AbortController().signal)).resolves.toEqual({
      status: 'ok',
      identity: 'Kyle Richards',
      message: null,
      missingScopes: [],
      projects: ['Hicora', 'OnSite Companion'],
      scopes: [
        { scope: 'work-items', access: 'read', status: 'granted' },
        { scope: 'work-items', access: 'write', status: 'unverified' },
        { scope: 'code', access: 'read', status: 'granted' },
        { scope: 'code', access: 'write', status: 'unverified' },
        { scope: 'build', access: 'read', status: 'granted' },
      ],
    });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${ORG_URL}/_apis/connectionData?api-version=${CONNECTION_DATA_API_VERSION}`);
    expect(new Headers(init?.headers).get('authorization')).toBe(`Basic ${btoa(`:${PAT}`)}`);
    // The probes ran in the default project.
    expect(fetch.mock.calls.filter(([called]) => called.includes('/OnSite%20Companion/_apis/'))).toHaveLength(3);
  });

  it('a PAT without Build (read) passes, with Build missing', async () => {
    const test = createAdoConnectionTester({ fetch: fakeAdo({ build: 401 }) });
    const outcome = await test(draft, new AbortController().signal);

    expect(outcome).toMatchObject({ status: 'ok', identity: 'Kyle Richards', missingScopes: ['build'] });
    expect(outcome.scopes?.find((check) => check.scope === 'build')).toEqual({ scope: 'build', access: 'read', status: 'missing' });
  });

  it('prefers the name the user chose over the provider name', async () => {
    const custom = { authenticatedUser: { ...connectionData.authenticatedUser, customDisplayName: 'Kyle R.' } };
    const fetch = fakeAdo();
    fetch.mockImplementationOnce(async () => json(200, custom));
    const test = createAdoConnectionTester({ fetch });
    await expect(test(draft, new AbortController().signal)).resolves.toMatchObject({ identity: 'Kyle R.' });
  });

  it('reports a rejected token without echoing it, and probes nothing else', async () => {
    const fetch = fakeAdo({ connectionData: 401 });
    const test = createAdoConnectionTester({ fetch });
    const outcome = await test(draft, new AbortController().signal);

    expect(outcome).toMatchObject({ status: 'error', identity: null });
    expect(outcome.message).toMatch(/rejected the personal access token \(401/);
    expect(outcome.scopes).toBeUndefined();
    expect(JSON.stringify(outcome)).not.toContain(PAT);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('reports an unreachable server', async () => {
    const test = createAdoConnectionTester({
      fetch: async () => {
        throw new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND dev.azure.com') });
      },
    });
    const outcome = await test(draft, new AbortController().signal);
    expect(outcome).toMatchObject({ status: 'error', identity: null, message: expect.stringContaining('Could not reach Azure DevOps') });
  });

  it('refuses a URL it would not send the token to, before sending anything', async () => {
    const fetch = fakeAdo();
    const test = createAdoConnectionTester({ fetch });
    const outcome = await test({ ...draft, orgUrl: 'http://dev.azure.com/contoso' }, new AbortController().signal);

    expect(outcome).toMatchObject({ status: 'error' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops when the test is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = fakeAdo();
    const outcome = await createAdoConnectionTester({ fetch })(draft, controller.signal);

    expect(outcome).toMatchObject({ status: 'error', message: expect.stringContaining('cancelled') });
    expect(fetch).not.toHaveBeenCalled();
  });
});
