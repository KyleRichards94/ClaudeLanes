import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { isAdoErrorDetails } from './errors';
import { createTestClient, ORG_URL, useMswServer } from './testing/msw-server';

const server = useMswServer();

const LOGIN_PAGE = '<!DOCTYPE html><html><head><title>Azure DevOps Services | Sign In</title></head><body>Sign in</body></html>';

function adoError(status: number, message: string, typeKey: string) {
  return HttpResponse.json(
    { $id: '1', innerException: null, message, typeName: `Microsoft.TeamFoundation.${typeKey}`, typeKey, errorCode: 0, eventId: 3000 },
    { status, headers: { ActivityId: 'a1b2c3d4-0000-0000-0000-000000000000' } },
  );
}

/** One request to a path whose handler answers with `response`; how many requests ADO saw. */
async function callWith(response: () => Response) {
  let requests = 0;
  server.use(
    http.get(`${ORG_URL}/_apis/projects`, () => {
      requests += 1;
      return response();
    }),
  );
  const { client, sleeps } = createTestClient();
  const result = await client.get('/_apis/projects', z.object({ count: z.number() }));
  return { result, requests, sleeps };
}

describe('error mapping (design §12 codes)', () => {
  it('401 → ADO_UNAUTHORIZED, with ADO message and activity id', async () => {
    const { result, requests } = await callWith(() =>
      adoError(401, 'TF400813: The user is not authorized to access this resource.', 'UnauthorizedRequestException'),
    );
    expect(result).toMatchObject({
      ok: false,
      code: 'ADO_UNAUTHORIZED',
      details: {
        source: 'ado',
        kind: 'unauthorized',
        status: 401,
        method: 'GET',
        url: `${ORG_URL}/_apis/projects?api-version=7.1`,
        attempts: 1,
        activityId: 'a1b2c3d4-0000-0000-0000-000000000000',
        adoMessage: 'TF400813: The user is not authorized to access this resource.',
        adoTypeKey: 'UnauthorizedRequestException',
      },
    });
    expect(!result.ok && result.message).toMatch(/expired or been revoked.*TF400813/);
    expect(requests).toBe(1);
  });

  it('403 → ADO_SCOPE_MISSING', async () => {
    const { result } = await callWith(() =>
      adoError(403, 'Access Denied: the token needs vso.work_write.', 'UnauthorizedAccessException'),
    );
    expect(result).toMatchObject({ ok: false, code: 'ADO_SCOPE_MISSING', details: { kind: 'forbidden', status: 403 } });
    expect(!result.ok && result.message).toContain('Work Items (read & write)');
  });

  it('203 with the sign-in page → ADO_SCOPE_MISSING', async () => {
    const { result } = await callWith(() => HttpResponse.html(LOGIN_PAGE, { status: 203 }));
    expect(result).toMatchObject({ ok: false, code: 'ADO_SCOPE_MISSING', details: { kind: 'login-page', status: 203 } });
  });

  it('203 even without an HTML content type → ADO_SCOPE_MISSING', async () => {
    const { result } = await callWith(() => HttpResponse.json({ count: 1 }, { status: 203 }));
    expect(result).toMatchObject({ ok: false, code: 'ADO_SCOPE_MISSING', details: { kind: 'login-page' } });
  });

  it('200 with the sign-in page (a followed redirect) → ADO_SCOPE_MISSING', async () => {
    const { result } = await callWith(() => HttpResponse.html(LOGIN_PAGE));
    expect(result).toMatchObject({ ok: false, code: 'ADO_SCOPE_MISSING', details: { kind: 'login-page', status: 200 } });
  });

  it('400 → VALIDATION', async () => {
    const { result } = await callWith(() => adoError(400, 'TF51006: The query statement is missing a FROM clause.', 'WiqlParseException'));
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION', details: { kind: 'http', status: 400, adoTypeKey: 'WiqlParseException' } });
  });

  it('404 → INTERNAL with the status and ADO message', async () => {
    const { result } = await callWith(() => adoError(404, 'TF200016: The following project does not exist: Nope.', 'ProjectDoesNotExistException'));
    expect(result).toMatchObject({ ok: false, code: 'INTERNAL', details: { kind: 'http', status: 404, adoTypeKey: 'ProjectDoesNotExistException' } });
    expect(!result.ok && result.message).toContain('TF200016');
  });

  it('500 → INTERNAL, not retried', async () => {
    const { result, requests, sleeps } = await callWith(() => new HttpResponse('oops', { status: 500 }));
    expect(result).toMatchObject({ ok: false, code: 'INTERNAL', details: { kind: 'http', status: 500, attempts: 1 } });
    expect(requests).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('a non-JSON error body still maps by status', async () => {
    const { result } = await callWith(() => new HttpResponse('Unauthorized', { status: 401, headers: { 'content-type': 'text/plain' } }));
    expect(result).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });
    expect(result).not.toHaveProperty('details.adoMessage');
  });
});

describe('isAdoErrorDetails', () => {
  it('recognises the client details and nothing else', () => {
    expect(isAdoErrorDetails({ source: 'ado', kind: 'http' })).toBe(true);
    expect(isAdoErrorDetails({ kind: 'http' })).toBe(false);
    expect(isAdoErrorDetails(undefined)).toBe(false);
    expect(isAdoErrorDetails('ado')).toBe(false);
  });
});
