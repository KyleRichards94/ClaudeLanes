import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { runWiql, wiqlString } from './wiql';
import { createTestClient, ORG_URL, useMswServer } from './testing/msw-server';

const server = useMswServer();

describe('wiqlString', () => {
  it.each([
    ['Sprint 42', "'Sprint 42'"],
    ['OnSite Companion\\Sprint 42', "'OnSite Companion\\Sprint 42'"],
    ["O'Brien", "'O''Brien'"],
    ["x' OR [System.Id] > 0 OR 'y", "'x'' OR [System.Id] > 0 OR ''y'"],
    ['', "''"],
  ])('quotes %j as %s', (value, quoted) => {
    expect(wiqlString(value)).toBe(quoted);
  });
});

describe('runWiql', () => {
  it('POSTs the query to the project with $top and returns the ids in order', async () => {
    let seen: { path: string; top: string | null; body: unknown; contentType: string | null } | undefined;
    server.use(
      http.post(`${ORG_URL}/:project/_apis/wit/wiql`, async ({ request }) => {
        const url = new URL(request.url);
        seen = { path: url.pathname, top: url.searchParams.get('$top'), body: await request.json(), contentType: request.headers.get('content-type') };
        return HttpResponse.json({ queryType: 'flat', workItems: [{ id: 71341, url: 'x' }, { id: 71273, url: 'y' }] });
      }),
    );

    const { client } = createTestClient();
    const result = await runWiql(client, { project: 'OnSite Companion', query: 'SELECT [System.Id] FROM WorkItems', top: 5 });

    expect(result).toEqual({ ok: true, data: [71341, 71273] });
    expect(seen).toEqual({
      path: '/contoso/OnSite%20Companion/_apis/wit/wiql',
      top: '5',
      body: { query: 'SELECT [System.Id] FROM WorkItems' },
      contentType: 'application/json',
    });
  });

  it("returns ADO's 400 for a bad query as VALIDATION with its message", async () => {
    server.use(
      http.post(`${ORG_URL}/:project/_apis/wit/wiql`, () =>
        HttpResponse.json({ message: 'TF51006: The query statement is not valid.' }, { status: 400 }),
      ),
    );
    const { client } = createTestClient();
    const result = await runWiql(client, { project: 'P', query: 'SELECT', top: 1 });
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION', details: { status: 400, adoMessage: 'TF51006: The query statement is not valid.' } });
  });
});
