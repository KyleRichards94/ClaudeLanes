import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAdoClient } from './client';
import { isAdoErrorDetails } from './errors';
import { adoPath } from './path';
import { createTestClient, FAKE_AUTHORIZATION, FAKE_PAT, ORG_URL, useMswServer } from './testing/msw-server';

const server = useMswServer();

const projectSchema = z.object({ id: z.string(), name: z.string() });

describe('createAdoClient', () => {
  it('normalises the organisation URL', () => {
    const created = createAdoClient({ orgUrl: ' https://dev.azure.com/contoso/ ', pat: FAKE_PAT });
    expect(created.ok && created.data.orgUrl).toBe(ORG_URL);
  });

  it.each([
    ['not a URL', 'zzinput'],
    ['plain http', 'http://dev.azure.com/zzinput'],
    ['credentials in the URL', `https://me:${FAKE_PAT}@dev.azure.com/zzinput`],
    ['more than an organisation on dev.azure.com', 'https://dev.azure.com/zzinput/extra'],
  ])('refuses an org URL with %s, without echoing it', (_case, orgUrl) => {
    const created = createAdoClient({ orgUrl, pat: FAKE_PAT });
    expect(created).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(JSON.stringify(created)).not.toContain(FAKE_PAT);
    expect(JSON.stringify(created)).not.toContain('zzinput');
  });

  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['inner spaces', 'abc def'],
    ['non-ASCII', 'pät-token'],
  ])('refuses a PAT that is %s', (_case, pat) => {
    const created = createAdoClient({ orgUrl: ORG_URL, pat });
    expect(created).toMatchObject({ ok: false, code: 'VALIDATION' });
    if (pat.trim() !== '') expect(JSON.stringify(created)).not.toContain(pat);
  });

  it('refuses a non-positive timeout or a negative retry count', () => {
    expect(createAdoClient({ orgUrl: ORG_URL, pat: FAKE_PAT, timeoutMs: 0 })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(createAdoClient({ orgUrl: ORG_URL, pat: FAKE_PAT, retry: { maxRetries: -1 } })).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('keeps the PAT out of the client object', () => {
    const { client } = createTestClient();
    expect(JSON.stringify(client)).not.toContain(FAKE_PAT);
    expect(Object.values(client).filter((value) => typeof value === 'string')).toEqual([ORG_URL]);
  });
});

describe('request', () => {
  it('sends the PAT as Basic auth with api-version 7.1 and validates the JSON response', async () => {
    let seen: Request | undefined;
    server.use(
      http.get(`${ORG_URL}/_apis/projects/:id`, ({ request, params }) => {
        seen = request;
        return HttpResponse.json({ id: params['id'], name: 'Onsite', extra: 'ignored' });
      }),
    );

    const { client } = createTestClient();
    const result = await client.get('/_apis/projects/p1', projectSchema);

    expect(result).toEqual({ ok: true, data: { id: 'p1', name: 'Onsite' } });
    expect(seen?.headers.get('authorization')).toBe(FAKE_AUTHORIZATION);
    expect(atob(FAKE_AUTHORIZATION.slice('Basic '.length))).toBe(`:${FAKE_PAT}`);
    expect(seen?.headers.get('accept')).toBe('application/json');
    expect(seen?.headers.get('x-tfs-fedauthredirect')).toBe('Suppress');
    expect(new URL(seen!.url).searchParams.get('api-version')).toBe('7.1');
  });

  it('builds the query: arrays comma-joined, empty values skipped, api-version overridable', async () => {
    let url: URL | undefined;
    server.use(
      http.get(`${ORG_URL}/_apis/wit/workitems`, ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({});
      }),
    );

    const { client } = createTestClient();
    await client.get('/_apis/wit/workitems', z.unknown(), {
      query: { ids: [71273, 71330], fields: ['System.Id', 'System.Title'], $expand: undefined, asOf: null, errorPolicy: 'omit' },
      apiVersion: '7.1-preview.3',
    });

    expect(url?.searchParams.get('ids')).toBe('71273,71330');
    expect(url?.searchParams.get('fields')).toBe('System.Id,System.Title');
    expect(url?.searchParams.has('$expand')).toBe(false);
    expect(url?.searchParams.has('asOf')).toBe(false);
    expect(url?.searchParams.get('errorPolicy')).toBe('omit');
    expect(url?.searchParams.get('api-version')).toBe('7.1-preview.3');
  });

  it('keeps an api-version already in the path', async () => {
    let version: string | null = null;
    server.use(
      http.get(`${ORG_URL}/_apis/connectionData`, ({ request }) => {
        version = new URL(request.url).searchParams.get('api-version');
        return HttpResponse.json({});
      }),
    );
    const { client } = createTestClient();
    await client.get('/_apis/connectionData?api-version=7.1-preview', z.unknown());
    expect(version).toBe('7.1-preview');
  });

  it('reaches project and team paths built with adoPath', async () => {
    let path = '';
    server.use(
      http.get(`${ORG_URL}/:project/:team/_apis/work/teamsettings/iterations`, ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json({ count: 0, value: [] });
      }),
    );
    const { client } = createTestClient();
    const result = await client.get(adoPath`/${'Onsite Companion'}/${'Web/UI'}/_apis/work/teamsettings/iterations`, z.unknown());
    expect(result.ok).toBe(true);
    expect(path).toBe('/contoso/Onsite%20Companion/Web%2FUI/_apis/work/teamsettings/iterations');
  });

  it('sends a JSON body, with the content type the call asks for', async () => {
    const bodies: Array<{ contentType: string | null; body: unknown }> = [];
    server.use(
      http.post(`${ORG_URL}/:project/_apis/wit/wiql`, async ({ request }) => {
        bodies.push({ contentType: request.headers.get('content-type'), body: await request.json() });
        return HttpResponse.json({ workItems: [] });
      }),
      http.patch(`${ORG_URL}/_apis/wit/workitems/:id`, async ({ request }) => {
        bodies.push({ contentType: request.headers.get('content-type'), body: await request.json() });
        return HttpResponse.json({ id: 71273 });
      }),
    );

    const { client } = createTestClient();
    await client.request({ method: 'POST', path: '/Onsite/_apis/wit/wiql', body: { query: 'SELECT [System.Id] FROM WorkItems' }, schema: z.unknown() });
    await client.request({
      method: 'PATCH',
      path: '/_apis/wit/workitems/71273',
      body: [{ op: 'add', path: '/fields/System.State', value: 'Active' }],
      contentType: 'application/json-patch+json',
      schema: z.unknown(),
    });

    expect(bodies).toEqual([
      { contentType: 'application/json', body: { query: 'SELECT [System.Id] FROM WorkItems' } },
      { contentType: 'application/json-patch+json', body: [{ op: 'add', path: '/fields/System.State', value: 'Active' }] },
    ]);
  });

  it('validates an empty 204 body as undefined', async () => {
    server.use(http.delete(`${ORG_URL}/_apis/thing/1`, () => new HttpResponse(null, { status: 204 })));
    const { client } = createTestClient();
    expect(await client.request({ method: 'DELETE', path: '/_apis/thing/1', schema: z.undefined() })).toEqual({ ok: true, data: undefined });
  });

  it('returns VALIDATION with the zod issues when the response has the wrong shape', async () => {
    server.use(http.get(`${ORG_URL}/_apis/projects/p1`, () => HttpResponse.json({ id: 42 })));
    const { client } = createTestClient();
    const result = await client.get('/_apis/projects/p1', projectSchema);

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION', details: { source: 'ado', kind: 'schema', status: 200 } });
    const details = !result.ok && isAdoErrorDetails(result.details) ? result.details : undefined;
    expect(details?.issues?.map((issue) => issue.path)).toEqual(['$.id', '$.name']);
  });

  it('returns VALIDATION when a 2xx body is not JSON', async () => {
    server.use(http.get(`${ORG_URL}/_apis/projects`, () => HttpResponse.text('{ not json', { headers: { 'content-type': 'application/json' } })));
    const { client } = createTestClient();
    expect(await client.get('/_apis/projects', z.unknown())).toMatchObject({ ok: false, code: 'VALIDATION', details: { kind: 'invalid-json' } });
  });

  it('times out a request that never answers', async () => {
    server.use(
      http.get(`${ORG_URL}/_apis/projects`, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    const { client } = createTestClient({ timeoutMs: 50 });
    const result = await client.get('/_apis/projects', z.unknown());
    expect(result).toMatchObject({ ok: false, code: 'INTERNAL', details: { kind: 'timeout', attempts: 1 } });
    expect(!result.ok && result.message).toContain('within 50 ms');
  });

  it('lets a call override the timeout', async () => {
    server.use(
      http.get(`${ORG_URL}/_apis/projects`, async () => {
        await delay(200);
        return HttpResponse.json({});
      }),
    );
    const { client } = createTestClient({ timeoutMs: 10_000 });
    expect(await client.get('/_apis/projects', z.unknown(), { timeoutMs: 20 })).toMatchObject({ ok: false, details: { kind: 'timeout' } });
  });

  it('stops when the caller aborts', async () => {
    server.use(
      http.get(`${ORG_URL}/_apis/projects`, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    const { client } = createTestClient();
    const controller = new AbortController();
    const pending = client.get('/_apis/projects', z.unknown(), { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);
    expect(await pending).toMatchObject({ ok: false, code: 'INTERNAL', details: { kind: 'aborted' } });
  });

  it('maps a network failure to INTERNAL', async () => {
    server.use(http.get(`${ORG_URL}/_apis/projects`, () => HttpResponse.error()));
    const { client } = createTestClient();
    expect(await client.get('/_apis/projects', z.unknown())).toMatchObject({ ok: false, code: 'INTERNAL', details: { kind: 'network', attempts: 1 } });
  });

  it('uses the injected fetch', async () => {
    const fetch = vi.fn(async () => Response.json({ id: 'p1', name: 'Onsite' }));
    const { client } = createTestClient({ fetch });
    expect(await client.get('/_apis/projects/p1', projectSchema)).toEqual({ ok: true, data: { id: 'p1', name: 'Onsite' } });
    expect(fetch).toHaveBeenCalledWith(`${ORG_URL}/_apis/projects/p1?api-version=7.1`, expect.objectContaining({ method: 'GET' }));
  });

  it('never throws, even when fetch throws synchronously', async () => {
    const { client } = createTestClient({
      fetch: () => {
        throw new TypeError('boom');
      },
    });
    expect(await client.get('/_apis/projects', z.unknown())).toMatchObject({ ok: false, code: 'INTERNAL', details: { kind: 'network', cause: 'boom' } });
  });

  it('never throws when a schema transform throws', async () => {
    server.use(http.get(`${ORG_URL}/_apis/projects`, () => HttpResponse.json({})));
    const { client } = createTestClient();
    const exploding = z.unknown().transform(() => {
      throw new Error('transform failed');
    });
    expect(await client.get('/_apis/projects', exploding)).toMatchObject({ ok: false, code: 'INTERNAL', details: { kind: 'unexpected' } });
  });

  it('ignores a logger that throws', async () => {
    server.use(http.get(`${ORG_URL}/_apis/projects`, () => HttpResponse.json([])));
    const { client } = createTestClient({
      log: () => {
        throw new Error('logger down');
      },
    });
    expect(await client.get('/_apis/projects', z.array(z.unknown()))).toEqual({ ok: true, data: [] });
  });
});

describe('where the PAT may go', () => {
  it.each([
    ['a path without a leading slash', '_apis/projects'],
    ['a path that climbs out of the organisation', '/../fabrikam/_apis/projects'],
    ['an encoded climb', '/%2e%2e/fabrikam/_apis/projects'],
    ['another host', 'https://example.com/_apis/projects'],
    ['plain http on the ADO host', 'http://dev.azure.com/contoso/_apis/projects'],
    ['a look-alike host', 'https://dev.azure.com.evil.example/contoso/_apis/projects'],
    ['credentials in the URL', 'https://user:pw@vssps.dev.azure.com/contoso/_apis/profile'],
  ])('refuses %s without sending anything', async (_case, path) => {
    const fetch = vi.fn(async () => Response.json({}));
    const { client } = createTestClient({ fetch });
    expect(await client.get(path, z.unknown())).toMatchObject({ ok: false, code: 'VALIDATION', details: { kind: 'config' } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('follows absolute links to the organisation and to other Azure DevOps Services hosts', async () => {
    server.use(
      http.get('https://vssps.dev.azure.com/contoso/_apis/profile/profiles/me', () => HttpResponse.json({ displayName: 'Kyle' })),
      http.get(`${ORG_URL}/_apis/projects`, () => HttpResponse.json({ count: 0, value: [] })),
    );
    const { client } = createTestClient();
    expect(await client.get('https://vssps.dev.azure.com/contoso/_apis/profile/profiles/me', z.object({ displayName: z.string() }))).toEqual({
      ok: true,
      data: { displayName: 'Kyle' },
    });
    expect((await client.get(`${ORG_URL}/_apis/projects`, z.unknown())).ok).toBe(true);
  });

  it('keeps an on-premises server to its own origin', async () => {
    const fetch = vi.fn(async () => Response.json({}));
    const { client } = createTestClient({ orgUrl: 'https://tfs.example.local/tfs/DefaultCollection', fetch });
    expect((await client.get('https://vssps.dev.azure.com/contoso/_apis/profile', z.unknown())).ok).toBe(false);
    expect((await client.get('/_apis/projects', z.unknown())).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('https://tfs.example.local/tfs/DefaultCollection/_apis/projects?api-version=7.1', expect.anything());
  });
});
