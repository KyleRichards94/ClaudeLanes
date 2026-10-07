import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseRetryAfter } from './retry';
import { createTestClient, ORG_URL, useMswServer } from './testing/msw-server';

const server = useMswServer();

const countSchema = z.object({ count: z.number() });

/** Answers each request with the next response in `script`; the last one repeats. */
function scripted(path: string, script: Array<() => Response>) {
  const seen: Request[] = [];
  server.use(
    http.all(`${ORG_URL}${path}`, ({ request }) => {
      seen.push(request.clone());
      const next = script[Math.min(seen.length - 1, script.length - 1)]!;
      return next();
    }),
  );
  return seen;
}

const throttled = (retryAfter?: string) => () =>
  HttpResponse.json(
    { message: 'TF400733: The request has been throttled.' },
    { status: 429, headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter } },
  );
const unavailable = () => new HttpResponse('Service Unavailable', { status: 503 });
const success = () => HttpResponse.json({ count: 7 });

describe('429 / 503 retry', () => {
  it('waits for Retry-After, then succeeds', async () => {
    const seen = scripted('/_apis/projects', [throttled('2'), success]);
    const { client, sleeps, logs } = createTestClient();

    expect(await client.get('/_apis/projects', countSchema)).toEqual({ ok: true, data: { count: 7 } });
    expect(sleeps).toEqual([2_000]);
    expect(seen).toHaveLength(2);
    expect(logs.map((entry) => entry.level)).toEqual(['warn', 'debug']);
    expect(logs[0]?.message).toContain('retry 1 of 3 in 2000 ms');
  });

  it('backs off 1 s, 2 s, 4 s on 503 without Retry-After', async () => {
    const seen = scripted('/_apis/projects', [unavailable, unavailable, unavailable, success]);
    const { client, sleeps } = createTestClient();

    expect(await client.get('/_apis/projects', countSchema)).toEqual({ ok: true, data: { count: 7 } });
    expect(sleeps).toEqual([1_000, 2_000, 4_000]);
    expect(seen).toHaveLength(4);
  });

  it('gives up after 3 retries', async () => {
    const seen = scripted('/_apis/projects', [throttled('1')]);
    const { client, sleeps } = createTestClient();

    const result = await client.get('/_apis/projects', countSchema);
    expect(result).toMatchObject({
      ok: false,
      code: 'INTERNAL',
      details: { kind: 'throttled', status: 429, attempts: 4, retryAfterMs: 1_000, adoMessage: 'TF400733: The request has been throttled.' },
    });
    expect(!result.ok && result.message).toContain('after 3 retries');
    expect(sleeps).toEqual([1_000, 1_000, 1_000]);
    expect(seen).toHaveLength(4);
  });

  it('honours a Retry-After HTTP date', async () => {
    scripted('/_apis/projects', [throttled('Wed, 07 Oct 2026 01:00:05 GMT'), success]);
    const { client, sleeps } = createTestClient({ now: () => Date.parse('Wed, 07 Oct 2026 01:00:00 GMT') });

    expect((await client.get('/_apis/projects', countSchema)).ok).toBe(true);
    expect(sleeps).toEqual([5_000]);
  });

  it('does not block on a Retry-After longer than the client waits', async () => {
    const seen = scripted('/_apis/projects', [throttled('120'), success]);
    const { client, sleeps } = createTestClient();

    const result = await client.get('/_apis/projects', countSchema);
    expect(result).toMatchObject({ ok: false, code: 'INTERNAL', details: { kind: 'throttled', attempts: 1, retryAfterMs: 120_000 } });
    expect(!result.ok && result.message).toContain('asked to wait 120 s');
    expect(sleeps).toEqual([]);
    expect(seen).toHaveLength(1);
  });

  it('takes the retry count and delays from options', async () => {
    const seen = scripted('/_apis/projects', [unavailable]);
    const { client, sleeps } = createTestClient({ retry: { maxRetries: 1, baseDelayMs: 50 } });

    expect(await client.get('/_apis/projects', countSchema)).toMatchObject({ ok: false, details: { kind: 'throttled', attempts: 2, status: 503 } });
    expect(sleeps).toEqual([50]);
    expect(seen).toHaveLength(2);
  });

  it('re-sends the body when a POST is retried', async () => {
    const seen = scripted('/Onsite/_apis/wit/wiql', [throttled('0'), () => HttpResponse.json({ workItems: [] })]);
    const { client } = createTestClient();

    const result = await client.request({ method: 'POST', path: '/Onsite/_apis/wit/wiql', body: { query: 'SELECT [System.Id] FROM WorkItems' }, schema: z.unknown() });
    expect(result.ok).toBe(true);
    expect(await Promise.all(seen.map((request) => request.json()))).toEqual([
      { query: 'SELECT [System.Id] FROM WorkItems' },
      { query: 'SELECT [System.Id] FROM WorkItems' },
    ]);
  });

  it('stops waiting when the caller aborts during the back-off', async () => {
    scripted('/_apis/projects', [throttled('1'), success]);
    const controller = new AbortController();
    const { client } = createTestClient({
      sleep: (_ms, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason));
          controller.abort();
        }),
    });

    expect(await client.get('/_apis/projects', countSchema, { signal: controller.signal })).toMatchObject({
      ok: false,
      code: 'INTERNAL',
      details: { kind: 'aborted', status: 429 },
    });
  });

  it('uses real timers by default', async () => {
    scripted('/_apis/projects', [throttled('0.01'), success]);
    const { client } = createTestClient({ sleep: undefined });
    expect(await client.get('/_apis/projects', countSchema)).toEqual({ ok: true, data: { count: 7 } });
  });
});

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-10-07T01:00:00Z');

  it.each([
    ['5', 5_000],
    ['0', 0],
    ['1.5', 1_500],
    [' 3 ', 3_000],
    ['Wed, 07 Oct 2026 01:00:30 GMT', 30_000],
    ['Wed, 07 Oct 2026 00:59:00 GMT', 0],
  ])('%j → %d ms', (header, ms) => {
    expect(parseRetryAfter(header, now)).toBe(ms);
  });

  it.each([null, '', 'soon', '-1'])('%j → undefined', (header) => {
    expect(parseRetryAfter(header, now)).toBeUndefined();
  });
});
