import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isAdoErrorDetails } from './errors';
import { createTestClient, ORG_URL, useMswServer } from './testing/msw-server';

const server = useMswServer();

const teamSchema = z.object({ id: z.string(), name: z.string() });
const team = (n: number) => ({ id: `t${n}`, name: `Team ${n}` });
const teams = (from: number, count: number) => Array.from({ length: count }, (_, i) => team(from + i));

describe('list (continuation-token paging)', () => {
  it('follows x-ms-continuationtoken headers across pages', async () => {
    const tokens: Array<string | null> = [];
    // The second token has characters that must survive URL encoding.
    const pages: Record<string, { items: unknown[]; next?: string }> = {
      first: { items: teams(1, 100), next: 'abc+/=' },
      'abc+/=': { items: teams(101, 100), next: 'page-3' },
      'page-3': { items: teams(201, 25) },
    };
    server.use(
      http.get(`${ORG_URL}/_apis/projects/Onsite/teams`, ({ request }) => {
        const token = new URL(request.url).searchParams.get('continuationToken');
        tokens.push(token);
        const page = pages[token ?? 'first']!;
        return HttpResponse.json(
          { count: page.items.length, value: page.items },
          { headers: page.next ? { 'x-ms-continuationtoken': page.next } : {} },
        );
      }),
    );

    const { client } = createTestClient();
    const result = await client.list('/_apis/projects/Onsite/teams', teamSchema, { query: { $top: 100 } });

    expect(result.ok && result.data).toHaveLength(225);
    expect(result.ok && result.data.map((t) => t.id).slice(98, 102)).toEqual(['t99', 't100', 't101', 't102']);
    expect(result.ok && result.data.at(-1)).toEqual(team(225));
    expect(tokens).toEqual([null, 'abc+/=', 'page-3']);
  });

  it('keeps the call query and api-version on every page', async () => {
    const urls: URL[] = [];
    server.use(
      http.get(`${ORG_URL}/_apis/projects`, ({ request }) => {
        const url = new URL(request.url);
        urls.push(url);
        const first = !url.searchParams.has('continuationToken');
        return HttpResponse.json({ value: first ? [team(1)] : [team(2)] }, { headers: first ? { 'x-ms-continuationtoken': '2' } : {} });
      }),
    );

    const { client } = createTestClient();
    expect((await client.list('/_apis/projects', teamSchema, { query: { stateFilter: 'wellFormed' } })).ok).toBe(true);
    expect(urls.map((url) => [url.searchParams.get('stateFilter'), url.searchParams.get('api-version')])).toEqual([
      ['wellFormed', '7.1'],
      ['wellFormed', '7.1'],
    ]);
  });

  it('follows a continuationToken in the body, with a custom items key', async () => {
    server.use(
      http.get(`${ORG_URL}/Onsite/_apis/wit/workItems/71273/comments`, ({ request }) => {
        const token = new URL(request.url).searchParams.get('continuationToken');
        return token === null
          ? HttpResponse.json({ totalCount: 3, count: 2, comments: [{ id: 1 }, { id: 2 }], continuationToken: 'c2' })
          : HttpResponse.json({ totalCount: 3, count: 1, comments: [{ id: 3 }], continuationToken: null });
      }),
    );

    const { client } = createTestClient();
    const result = await client.list('/Onsite/_apis/wit/workItems/71273/comments', z.object({ id: z.number() }), {
      itemsKey: 'comments',
      apiVersion: '7.1-preview.4',
    });
    expect(result).toEqual({ ok: true, data: [{ id: 1 }, { id: 2 }, { id: 3 }] });
  });

  it('makes one request for a single page', async () => {
    let requests = 0;
    server.use(
      http.get(`${ORG_URL}/_apis/projects`, () => {
        requests += 1;
        return HttpResponse.json({ count: 0, value: [] });
      }),
    );
    const { client } = createTestClient();
    expect(await client.list('/_apis/projects', teamSchema)).toEqual({ ok: true, data: [] });
    expect(requests).toBe(1);
  });

  it('fails the whole call when a later page fails', async () => {
    server.use(
      http.get(`${ORG_URL}/_apis/projects`, ({ request }) =>
        new URL(request.url).searchParams.has('continuationToken')
          ? HttpResponse.json({ message: 'TF400813: not authorized' }, { status: 401 })
          : HttpResponse.json({ value: [team(1)] }, { headers: { 'x-ms-continuationtoken': 'next' } }),
      ),
    );
    const { client } = createTestClient();
    expect(await client.list('/_apis/projects', teamSchema)).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });
  });

  it('retries a throttled page and carries on', async () => {
    let throttledOnce = false;
    server.use(
      http.get(`${ORG_URL}/_apis/projects`, ({ request }) => {
        if (!new URL(request.url).searchParams.has('continuationToken')) {
          return HttpResponse.json({ value: [team(1)] }, { headers: { 'x-ms-continuationtoken': 'next' } });
        }
        if (!throttledOnce) {
          throttledOnce = true;
          return new HttpResponse(null, { status: 429, headers: { 'Retry-After': '1' } });
        }
        return HttpResponse.json({ value: [team(2)] });
      }),
    );
    const { client, sleeps } = createTestClient();
    expect(await client.list('/_apis/projects', teamSchema)).toEqual({ ok: true, data: [team(1), team(2)] });
    expect(sleeps).toEqual([1_000]);
  });

  it('reports where an item fails validation', async () => {
    server.use(http.get(`${ORG_URL}/_apis/projects`, () => HttpResponse.json({ value: [team(1), { id: 2, name: 'Bad' }] })));
    const { client } = createTestClient();
    const result = await client.list('/_apis/projects', teamSchema);
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION', details: { kind: 'schema' } });
    expect(!result.ok && isAdoErrorDetails(result.details) && result.details.issues?.[0]?.path).toBe('$.value.1.id');
  });

  it('stops when ADO repeats a continuation token', async () => {
    server.use(http.get(`${ORG_URL}/_apis/projects`, () => HttpResponse.json({ value: [team(1)] }, { headers: { 'x-ms-continuationtoken': 'same' } })));
    const { client } = createTestClient();
    const result = await client.list('/_apis/projects', teamSchema);
    expect(result).toMatchObject({ ok: false, code: 'INTERNAL', details: { kind: 'paging', attempts: 2 } });
  });

  it('stops after maxPages', async () => {
    let n = 0;
    server.use(
      http.get(`${ORG_URL}/_apis/projects`, () => {
        n += 1;
        return HttpResponse.json({ value: [team(n)] }, { headers: { 'x-ms-continuationtoken': `t${n}` } });
      }),
    );
    const { client } = createTestClient();
    const result = await client.list('/_apis/projects', teamSchema, { maxPages: 3 });
    expect(result).toMatchObject({ ok: false, code: 'INTERNAL', details: { kind: 'paging' } });
    expect(n).toBe(3);
  });
});
