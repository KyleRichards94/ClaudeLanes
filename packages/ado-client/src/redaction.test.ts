import { type Result } from '@agent-lanes/contracts';
import { delay, http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type AdoClientOptions, type FetchLike } from './client';
import { createRedactor, REDACTED } from './redact';
import { createTestClient, FAKE_AUTHORIZATION, FAKE_PAT, ORG_URL, useMswServer } from './testing/msw-server';

const server = useMswServer();

/** Every form of the PAT that must never appear in an error or a log line. */
const FORBIDDEN = [FAKE_PAT, FAKE_AUTHORIZATION, FAKE_AUTHORIZATION.slice('Basic '.length), btoa(FAKE_PAT)];

/** A hostile server: echoes the credentials it received in its error body. */
function echoCredentials(status: number, contentType = 'application/json') {
  return http.all(`${ORG_URL}/_apis/echo`, ({ request }) => {
    const authorization = request.headers.get('authorization') ?? '';
    const pat = atob(authorization.replace('Basic ', '')).slice(1);
    const body = JSON.stringify({
      message: `TF000000: rejected ${authorization} for token ${pat}`,
      typeKey: `Key${pat}`,
      innerException: { headers: { Authorization: authorization } },
    });
    const headers: Record<string, string> = { 'content-type': contentType, ActivityId: pat };
    if (status === 429 || status === 503) headers['Retry-After'] = '1';
    return new HttpResponse(body, { status, headers });
  });
}

function throwingFetch(message: (pat: string, authorization: string) => string): FetchLike {
  return async (_url, init) => {
    const authorization = new Headers(init.headers).get('authorization') ?? '';
    const pat = atob(authorization.replace('Basic ', '')).slice(1);
    throw new TypeError('fetch failed', { cause: new Error(message(pat, authorization)) });
  };
}

interface Scenario {
  name: string;
  setup?: () => void;
  options?: Partial<AdoClientOptions>;
  call: (client: ReturnType<typeof createTestClient>['client']) => Promise<Result<unknown>>;
}

const echo = (client: ReturnType<typeof createTestClient>['client']) => client.get('/_apis/echo', z.object({ ok: z.literal(true) }));

const scenarios: Scenario[] = [
  { name: '401 ADO_UNAUTHORIZED', setup: () => server.use(echoCredentials(401)), call: echo },
  { name: '403 ADO_SCOPE_MISSING', setup: () => server.use(echoCredentials(403)), call: echo },
  { name: '203 sign-in page', setup: () => server.use(echoCredentials(203, 'text/html')), call: echo },
  { name: '200 sign-in page', setup: () => server.use(echoCredentials(200, 'text/html')), call: echo },
  { name: '400 VALIDATION', setup: () => server.use(echoCredentials(400)), call: echo },
  { name: '404 INTERNAL', setup: () => server.use(echoCredentials(404)), call: echo },
  { name: '500 INTERNAL', setup: () => server.use(echoCredentials(500)), call: echo },
  { name: '429 throttled after retries', setup: () => server.use(echoCredentials(429)), call: echo },
  { name: '503 unavailable after retries', setup: () => server.use(echoCredentials(503)), call: echo },
  {
    name: 'schema mismatch on a body holding the PAT',
    setup: () =>
      server.use(
        http.get(`${ORG_URL}/_apis/echo`, ({ request }) => {
          const pat = atob((request.headers.get('authorization') ?? '').replace('Basic ', '')).slice(1);
          return HttpResponse.json({ ok: pat, [pat]: pat });
        }),
      ),
    call: (client) => client.get('/_apis/echo', z.strictObject({ ok: z.enum(['yes']) })),
  },
  {
    name: 'non-JSON 200 body holding the PAT',
    setup: () => server.use(http.get(`${ORG_URL}/_apis/echo`, () => HttpResponse.text(`not json ${FAKE_PAT}`))),
    call: echo,
  },
  {
    name: 'timeout',
    setup: () =>
      server.use(
        http.get(`${ORG_URL}/_apis/echo`, async () => {
          await delay('infinite');
          return HttpResponse.json({});
        }),
      ),
    options: { timeoutMs: 20 },
    call: echo,
  },
  { name: 'network error from MSW', setup: () => server.use(http.get(`${ORG_URL}/_apis/echo`, () => HttpResponse.error())), call: echo },
  {
    name: 'network error whose cause quotes the header',
    options: { fetch: throwingFetch((_pat, authorization) => `connect ECONNRESET while sending Authorization: ${authorization}`) },
    call: echo,
  },
  { name: 'network error whose cause quotes the PAT', options: { fetch: throwingFetch((pat) => `bad token ${pat}`) }, call: echo },
  {
    name: 'unexpected throw quoting the PAT',
    setup: () => server.use(http.get(`${ORG_URL}/_apis/echo`, () => HttpResponse.json({}))),
    call: (client) =>
      client.get(
        '/_apis/echo',
        z.unknown().transform(() => {
          throw new Error(`exploded holding ${FAKE_PAT}`);
        }),
      ),
  },
  { name: 'refused path quoting the PAT', call: (client) => client.get(`no-slash/${FAKE_PAT}`, z.unknown()) },
  { name: 'refused host quoting the PAT', call: (client) => client.get(`https://example.com/${FAKE_PAT}`, z.unknown()) },
  {
    name: 'paging error after a page that echoed the PAT',
    setup: () =>
      server.use(http.get(`${ORG_URL}/_apis/echo`, () => HttpResponse.json({ value: [] }, { headers: { 'x-ms-continuationtoken': FAKE_PAT } }))),
    call: (client) => client.list('/_apis/echo', z.unknown()),
  },
];

describe('no error message or log line contains the PAT (AL-060)', () => {
  it.each(scenarios.map((scenario) => [scenario.name, scenario] as const))('%s', async (_name, scenario) => {
    scenario.setup?.();
    const { client, logs } = createTestClient(scenario.options);

    const result = await scenario.call(client);

    expect(result.ok).toBe(false);
    const surfaces = [JSON.stringify(result), ...(!result.ok ? [result.message] : []), ...logs.map((entry) => JSON.stringify(entry))];
    for (const surface of surfaces) {
      for (const secret of FORBIDDEN) expect(surface).not.toContain(secret);
    }
  });

  it('still logs every attempt, redacted', async () => {
    server.use(echoCredentials(429));
    const { client, logs } = createTestClient();
    await echo(client);
    expect(logs.map((entry) => entry.level)).toEqual(['warn', 'warn', 'warn', 'error']);
    expect(logs.every((entry) => entry.url === `${ORG_URL}/_apis/echo?api-version=7.1`)).toBe(true);
  });
});

describe('createRedactor', () => {
  const redact = createRedactor(FAKE_PAT, FAKE_AUTHORIZATION);

  it('replaces the PAT, the header and its base64 in strings', () => {
    expect(redact(`a ${FAKE_PAT} b`)).toBe(`a ${REDACTED} b`);
    expect(redact(`Authorization: ${FAKE_AUTHORIZATION}`)).toBe(`Authorization: Basic ${REDACTED}`);
    expect(redact(`x${FAKE_AUTHORIZATION.slice(6)}x`)).toBe(`x${REDACTED}x`);
  });

  it('replaces anyone’s Basic or Bearer credential', () => {
    expect(redact('Authorization: Bearer eyJhbGciOi.abc-def_ghi')).toBe(`Authorization: Bearer ${REDACTED}`);
    expect(redact('basic dXNlcjpwYXNz==')).toBe(`basic ${REDACTED}`);
  });

  it('walks objects, arrays and errors without changing other values', () => {
    const circular: Record<string, unknown> = { pat: FAKE_PAT };
    circular['self'] = circular;
    expect(redact({ n: 1, ok: true, list: [FAKE_PAT, null], error: new Error(`bad ${FAKE_PAT}`), circular })).toEqual({
      n: 1,
      ok: true,
      list: [REDACTED, null],
      error: `Error: bad ${REDACTED}`,
      circular: { pat: REDACTED, self: '[Circular]' },
    });
  });
});
