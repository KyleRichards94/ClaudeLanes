import type { AdoScope, AdoScopeCheck } from '@agent-lanes/contracts';
import { delay, http, HttpResponse, type HttpResponseResolver } from 'msw';
import { describe, expect, it } from 'vitest';
import {
  adoScopeOfRequest,
  CONNECTION_DATA_API_VERSION,
  getConnectionIdentity,
  listProjectNames,
  probeAdoScopes,
  PROJECTS_PAGE_SIZE,
  testAdoConnection,
  WORK_ITEMS_PROBE_QUERY,
} from './connection-test';
import { createTestClient, FAKE_AUTHORIZATION, FAKE_PAT, ORG_URL, useMswServer } from './testing/msw-server';

const server = useMswServer();

const LOGIN_PAGE = '<!DOCTYPE html><html><head><title>Azure DevOps Services | Sign In</title></head><body>Sign in</body></html>';

const KYLE = {
  authenticatedUser: { id: '6c3a2b1e-0000-4000-8000-000000000001', providerDisplayName: 'Kyle Richards', properties: {} },
  authorizedUser: { id: '6c3a2b1e-0000-4000-8000-000000000001', providerDisplayName: 'Kyle Richards' },
  instanceId: '00000000-0000-4000-8000-000000000002',
};

/** How the fake organisation answers one probe. */
type ProbeAnswer = 'ok' | 401 | 403 | 404 | 500 | 'login-page' | 'html-200' | 'network' | 'hang';

interface FakeOrg {
  /** connectionData: a body for 200, or an error status. */
  identity?: object | 401;
  /** Pages of project names, or an error status for the list. */
  projects?: string[][] | 401 | 403;
  probes?: Partial<Record<AdoScope, ProbeAnswer>>;
}

interface Seen {
  method: string;
  /** Path and query, e.g. `/contoso/Hicora/_apis/git/repositories?%24top=1&api-version=7.1`. */
  path: string;
  authorization: string | null;
  body?: unknown;
}

function answer(kind: ProbeAnswer, ok: () => Response): Response | Promise<Response> {
  switch (kind) {
    case 'ok':
      return ok();
    case 'login-page':
      return HttpResponse.html(LOGIN_PAGE, { status: 203 });
    case 'html-200':
      return HttpResponse.html(LOGIN_PAGE, { status: 200 });
    case 'network':
      return HttpResponse.error();
    case 'hang':
      return delay('infinite').then(() => ok());
    case 401:
      return HttpResponse.json(
        { $id: '1', message: 'TF400813: The user is not authorized to access this resource.', typeKey: 'UnauthorizedRequestException' },
        { status: 401 },
      );
    case 403:
      return HttpResponse.json({ message: 'Access denied: the personal access token lacks the required scope.' }, { status: 403 });
    default:
      return HttpResponse.json({ message: `Status ${kind}` }, { status: kind });
  }
}

/** Installs a whole fake organisation and returns every request it got. */
function fakeOrg(org: FakeOrg = {}): Seen[] {
  const seen: Seen[] = [];
  const record = async (request: Request): Promise<void> => {
    const url = new URL(request.url);
    const text = request.method === 'POST' ? await request.text() : '';
    seen.push({
      method: request.method,
      path: `${url.pathname}${url.search}`,
      authorization: request.headers.get('authorization'),
      ...(text ? { body: JSON.parse(text) as unknown } : {}),
    });
  };
  const probe = (scope: AdoScope, body: object): HttpResponseResolver => async ({ request }) => {
    await record(request);
    return answer(org.probes?.[scope] ?? 'ok', () => HttpResponse.json(body));
  };
  const pages = org.projects ?? [['OnSite Companion', 'Hicora']];

  server.use(
    http.get(`${ORG_URL}/_apis/connectionData`, async ({ request }) => {
      await record(request);
      const identity = org.identity ?? KYLE;
      return identity === 401 ? answer(401, () => HttpResponse.json({})) : HttpResponse.json(identity);
    }),
    http.get(`${ORG_URL}/_apis/projects`, async ({ request }) => {
      await record(request);
      if (typeof pages === 'number') return answer(pages, () => HttpResponse.json({}));
      const token = new URL(request.url).searchParams.get('continuationToken');
      const index = token === null ? 0 : Number(token);
      const names = pages[index] ?? [];
      const next = index + 1 < pages.length ? { 'x-ms-continuationtoken': String(index + 1) } : undefined;
      return HttpResponse.json(
        { count: names.length, value: names.map((name, n) => ({ id: `00000000-0000-4000-8000-00000000010${n}`, name, state: 'wellFormed' })) },
        next ? { headers: next } : {},
      );
    }),
    ...['', '/:project'].flatMap((prefix) => [
      http.post(`${ORG_URL}${prefix}/_apis/wit/wiql`, probe('work-items', { queryType: 'flat', workItems: [] })),
      http.get(`${ORG_URL}${prefix}/_apis/git/repositories`, probe('code', { count: 1, value: [{ id: 'r1', name: 'OnSiteCompanion' }] })),
      http.get(`${ORG_URL}${prefix}/_apis/build/builds`, probe('build', { count: 0, value: [] })),
    ]),
  );
  return seen;
}

function probePaths(seen: Seen[]): string[] {
  return seen.filter((request) => request.path.includes('/_apis/wit/') || request.path.includes('/_apis/git/') || request.path.includes('/_apis/build/')).map((request) => request.path);
}

function checks(read: Record<AdoScope, AdoScopeCheck['status']>, write: Partial<Record<AdoScope, AdoScopeCheck['status']>> = {}): AdoScopeCheck[] {
  return [
    { scope: 'work-items', access: 'read', status: read['work-items'] },
    { scope: 'work-items', access: 'write', status: write['work-items'] ?? 'unverified' },
    { scope: 'code', access: 'read', status: read.code },
    { scope: 'code', access: 'write', status: write.code ?? 'unverified' },
    { scope: 'build', access: 'read', status: read.build },
  ];
}

const ALL_GRANTED = checks({ 'work-items': 'granted', code: 'granted', build: 'granted' });

describe('testAdoConnection (AL-043)', () => {
  it('signs in, lists the projects and finds every read scope, leaving writes to be verified on first write', async () => {
    const seen = fakeOrg({ projects: [['OnSite Companion'], ['Hicora']] });
    const { client } = createTestClient();

    const result = await testAdoConnection(client);

    expect(result).toEqual({
      ok: true,
      data: {
        identity: { id: KYLE.authenticatedUser.id, displayName: 'Kyle Richards' },
        projects: ['Hicora', 'OnSite Companion'],
        scopes: ALL_GRANTED,
        missingScopes: [],
      },
    });
    // Identity first, then both project pages, then one probe per area in the first project.
    expect(seen.slice(0, 3).map((request) => request.path)).toEqual([
      `/contoso/_apis/connectionData?api-version=${CONNECTION_DATA_API_VERSION}`,
      `/contoso/_apis/projects?stateFilter=wellFormed&%24top=${PROJECTS_PAGE_SIZE}&api-version=7.1`,
      `/contoso/_apis/projects?stateFilter=wellFormed&%24top=${PROJECTS_PAGE_SIZE}&continuationToken=1&api-version=7.1`,
    ]);
    expect(probePaths(seen).toSorted()).toEqual([
      '/contoso/Hicora/_apis/build/builds?%24top=1&api-version=7.1',
      '/contoso/Hicora/_apis/git/repositories?%24top=1&api-version=7.1',
      '/contoso/Hicora/_apis/wit/wiql?%24top=1&api-version=7.1',
    ]);
    expect(seen.find((request) => request.method === 'POST')?.body).toEqual({ query: WORK_ITEMS_PROBE_QUERY });
    expect(seen.every((request) => request.authorization === FAKE_AUTHORIZATION)).toBe(true);
    // Reads only: nothing is written to prove a write scope.
    expect(seen.filter((request) => request.method !== 'GET').map((request) => request.path)).toEqual(['/contoso/Hicora/_apis/wit/wiql?%24top=1&api-version=7.1']);
  });

  it('a PAT without Build (read) shows Build as missing, and the test still passes', async () => {
    fakeOrg({ probes: { build: 401 } });
    const { client } = createTestClient();

    const result = await testAdoConnection(client);

    expect(result).toMatchObject({
      ok: true,
      data: { identity: { displayName: 'Kyle Richards' }, missingScopes: ['build'], scopes: checks({ 'work-items': 'granted', code: 'granted', build: 'missing' }) },
    });
  });

  it('a 403 marks the area missing, write access included', async () => {
    fakeOrg({ probes: { code: 403 } });
    const { client } = createTestClient();

    const result = await testAdoConnection(client);

    expect(result).toMatchObject({
      ok: true,
      data: { missingScopes: ['code'], scopes: checks({ 'work-items': 'granted', code: 'missing', build: 'granted' }, { code: 'missing' }) },
    });
  });

  it('a sign-in page instead of data (203, or HTML with a 200) marks the area missing', async () => {
    fakeOrg({ probes: { 'work-items': 'login-page', code: 'html-200' } });
    const { client } = createTestClient();

    const result = await testAdoConnection(client);

    expect(result).toMatchObject({
      ok: true,
      data: {
        missingScopes: ['work-items', 'code'],
        scopes: checks({ 'work-items': 'missing', code: 'missing', build: 'granted' }, { 'work-items': 'missing', code: 'missing' }),
      },
    });
  });

  it('a PAT with no required scope at all still signs in and shows all three missing', async () => {
    fakeOrg({ probes: { 'work-items': 401, code: 401, build: 401 } });
    const { client } = createTestClient();

    const result = await testAdoConnection(client);

    expect(result).toMatchObject({ ok: true, data: { identity: { displayName: 'Kyle Richards' }, missingScopes: ['work-items', 'code', 'build'] } });
  });

  it('a probe that fails for another reason proves nothing: unverified, not missing', async () => {
    fakeOrg({ probes: { 'work-items': 500, code: 'network', build: 404 } });
    const { client } = createTestClient();

    const result = await testAdoConnection(client);

    expect(result).toMatchObject({
      ok: true,
      data: { missingScopes: [], scopes: checks({ 'work-items': 'unverified', code: 'unverified', build: 'unverified' }) },
    });
  });

  it('a probe that never answers times out as unverified', async () => {
    fakeOrg({ probes: { build: 'hang' } });
    const { client } = createTestClient();

    const result = await testAdoConnection(client, { timeoutMs: 100 });

    expect(result).toMatchObject({ ok: true, data: { missingScopes: [], scopes: checks({ 'work-items': 'granted', code: 'granted', build: 'unverified' }) } });
  });

  it('probes in the default project when the token can see it', async () => {
    const seen = fakeOrg();
    const { client } = createTestClient();

    expect(await testAdoConnection(client, { defaultProject: 'onsite companion' })).toMatchObject({ ok: true, data: { scopes: ALL_GRANTED } });
    expect(probePaths(seen).toSorted()).toEqual([
      '/contoso/OnSite%20Companion/_apis/build/builds?%24top=1&api-version=7.1',
      '/contoso/OnSite%20Companion/_apis/git/repositories?%24top=1&api-version=7.1',
      '/contoso/OnSite%20Companion/_apis/wit/wiql?%24top=1&api-version=7.1',
    ]);
  });

  it('falls back to the first project when the default project is not visible to the token', async () => {
    const seen = fakeOrg();
    const { client } = createTestClient();

    await testAdoConnection(client, { defaultProject: 'Gone' });
    expect(probePaths(seen).every((path) => path.startsWith('/contoso/Hicora/'))).toBe(true);
  });

  it('still tests the scopes when the token may not list projects: projects are null, probes use the default project', async () => {
    const seen = fakeOrg({ projects: 401 });
    const { client } = createTestClient();

    const result = await testAdoConnection(client, { defaultProject: 'OnSite Companion' });

    expect(result).toMatchObject({ ok: true, data: { projects: null, scopes: ALL_GRANTED, missingScopes: [] } });
    expect(probePaths(seen).every((path) => path.startsWith('/contoso/OnSite%20Companion/'))).toBe(true);
  });

  it('probes at the organisation level when there is no project to probe in', async () => {
    const seen = fakeOrg({ projects: 403 });
    const { client } = createTestClient();

    expect(await testAdoConnection(client)).toMatchObject({ ok: true, data: { projects: null } });
    expect(probePaths(seen).toSorted()).toEqual([
      '/contoso/_apis/build/builds?%24top=1&api-version=7.1',
      '/contoso/_apis/git/repositories?%24top=1&api-version=7.1',
      '/contoso/_apis/wit/wiql?%24top=1&api-version=7.1',
    ]);
  });

  it('an organisation with no projects gives an empty list', async () => {
    fakeOrg({ projects: [[]] });
    const { client } = createTestClient();
    expect(await testAdoConnection(client)).toMatchObject({ ok: true, data: { projects: [] } });
  });

  it('a refused token fails the test at connectionData, before any probe, without echoing the PAT', async () => {
    const seen = fakeOrg({ identity: 401 });
    const { client } = createTestClient();

    const result = await testAdoConnection(client);

    expect(result).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });
    expect(seen.map((request) => request.path)).toEqual([`/contoso/_apis/connectionData?api-version=${CONNECTION_DATA_API_VERSION}`]);
    expect(JSON.stringify(result)).not.toContain(FAKE_PAT);
    expect(JSON.stringify(result)).not.toContain(FAKE_AUTHORIZATION.slice('Basic '.length));
  });

  it('nothing it returns holds the PAT', async () => {
    fakeOrg({ probes: { build: 401, code: 403 } });
    const { client } = createTestClient();
    const result = await testAdoConnection(client);
    expect(JSON.stringify(result)).not.toContain(FAKE_PAT);
  });
});

describe('getConnectionIdentity', () => {
  it("prefers the user's own display name", async () => {
    fakeOrg({ identity: { authenticatedUser: { ...KYLE.authenticatedUser, customDisplayName: 'Kyle R.' } } });
    const { client } = createTestClient();
    expect(await getConnectionIdentity(client)).toMatchObject({ ok: true, data: { displayName: 'Kyle R.' } });
  });

  it('gives a null name when ADO sends none', async () => {
    fakeOrg({ identity: { authenticatedUser: { id: KYLE.authenticatedUser.id } } });
    const { client } = createTestClient();
    expect(await getConnectionIdentity(client)).toEqual({ ok: true, data: { id: KYLE.authenticatedUser.id, displayName: null } });
  });

  it('treats an anonymous answer as a refused token', async () => {
    fakeOrg({ identity: { authenticatedUser: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', providerDisplayName: 'Anonymous' } } });
    const { client } = createTestClient();
    expect(await getConnectionIdentity(client)).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED', details: { kind: 'unauthorized' } });
  });
});

describe('listProjectNames', () => {
  it('follows continuation tokens and sorts the names without repeats', async () => {
    fakeOrg({ projects: [['Zeta', 'alpha'], ['Beta', 'alpha']] });
    const { client } = createTestClient();
    expect(await listProjectNames(client)).toEqual({ ok: true, data: ['alpha', 'Beta', 'Zeta'] });
  });

  it('passes a refusal through', async () => {
    fakeOrg({ projects: 401 });
    const { client } = createTestClient();
    expect(await listProjectNames(client)).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });
  });
});

describe('probeAdoScopes', () => {
  it('runs on its own, in the given project', async () => {
    const seen = fakeOrg({ probes: { build: 403 } });
    const { client } = createTestClient();

    expect(await probeAdoScopes(client, { project: 'Hicora' })).toEqual({
      ok: true,
      data: checks({ 'work-items': 'granted', code: 'granted', build: 'missing' }),
    });
    expect(seen).toHaveLength(3);
  });
});

describe('adoScopeOfRequest', () => {
  it.each([
    ['GET', `${ORG_URL}/Hicora/_apis/wit/workitems?ids=1,2`, { scope: 'work-items', access: 'read' }],
    ['POST', `${ORG_URL}/Hicora/_apis/wit/wiql?$top=200`, { scope: 'work-items', access: 'read' }],
    ['POST', `${ORG_URL}/_apis/wit/workitemsbatch`, { scope: 'work-items', access: 'read' }],
    ['GET', `${ORG_URL}/Hicora/Team/_apis/work/teamsettings/iterations`, { scope: 'work-items', access: 'read' }],
    ['POST', `${ORG_URL}/Hicora/_apis/wit/workItems/71273/comments`, { scope: 'work-items', access: 'write' }],
    ['PATCH', `${ORG_URL}/_apis/wit/workitems/71273`, { scope: 'work-items', access: 'write' }],
    ['GET', `${ORG_URL}/Hicora/_apis/git/repositories/r1/pullrequests/10612`, { scope: 'code', access: 'read' }],
    ['POST', `${ORG_URL}/Hicora/_apis/git/repositories/r1/pullrequests`, { scope: 'code', access: 'write' }],
    ['GET', `${ORG_URL}/Hicora/_apis/policy/evaluations`, { scope: 'code', access: 'read' }],
    ['GET', `${ORG_URL}/Hicora/_apis/build/builds?$top=1`, { scope: 'build', access: 'read' }],
    ['GET', '/OnSite%20Companion/_apis/Git/Repositories', { scope: 'code', access: 'read' }],
  ] as const)('%s %s', (method, url, expected) => {
    expect(adoScopeOfRequest(method, url)).toEqual(expected);
  });

  it.each([
    ['GET', `${ORG_URL}/_apis/connectionData`],
    ['GET', `${ORG_URL}/_apis/projects`],
    ['POST', `${ORG_URL}/Hicora/_apis/build/builds`],
    ['GET', 'not a url at all ::'],
  ])('%s %s needs none of the required scopes', (method, url) => {
    expect(adoScopeOfRequest(method, url)).toBeUndefined();
  });
});
