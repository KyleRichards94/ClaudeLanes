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

describe('ADO connection tester', () => {
  it('signs in with the PAT and reports who it belongs to', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => json(200, connectionData));
    const test = createAdoConnectionTester({ fetch });

    await expect(test(draft, new AbortController().signal)).resolves.toEqual({ status: 'ok', identity: 'Kyle Richards', message: null });

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(`${ORG_URL}/_apis/connectionData?api-version=${CONNECTION_DATA_API_VERSION}`);
    expect(new Headers(init?.headers).get('authorization')).toBe(`Basic ${btoa(`:${PAT}`)}`);
  });

  it('prefers the name the user chose over the provider name', async () => {
    const custom = { authenticatedUser: { ...connectionData.authenticatedUser, customDisplayName: 'Kyle R.' } };
    const test = createAdoConnectionTester({ fetch: async () => json(200, custom) });
    await expect(test(draft, new AbortController().signal)).resolves.toMatchObject({ identity: 'Kyle R.' });
  });

  it('reports a rejected token without echoing it', async () => {
    const test = createAdoConnectionTester({ fetch: async () => json(401, { message: 'TF400813: The user is not authorized.' }) });
    const outcome = await test(draft, new AbortController().signal);

    expect(outcome).toMatchObject({ status: 'error', identity: null });
    expect(outcome.message).toMatch(/rejected the personal access token \(401/);
    expect(JSON.stringify(outcome)).not.toContain(PAT);
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
    const fetch = vi.fn(async () => json(200, connectionData));
    const test = createAdoConnectionTester({ fetch });
    const outcome = await test({ ...draft, orgUrl: 'http://dev.azure.com/contoso' }, new AbortController().signal);

    expect(outcome).toMatchObject({ status: 'error' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
