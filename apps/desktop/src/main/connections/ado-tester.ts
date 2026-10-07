import { createAdoClient, testAdoConnection, type FetchLike } from '@agent-lanes/ado-client';
import type { ConnectionTester } from './testers';

export { CONNECTION_DATA_API_VERSION } from '@agent-lanes/ado-client';

export interface AdoConnectionTesterOptions {
  /** Defaults to the global `fetch`; tests pass a fake. */
  fetch?: FetchLike;
}

/**
 * Tests an ADO organisation the way design §8 says (AL-043): `GET {org}/_apis/connectionData` with
 * the PAT for the signed-in identity (a 401 fails the test), then the projects it can see for the
 * Default project dropdown, then one read per required area (Work Items, Code, Build) in the
 * default project or the first one listed. A refused probe marks that scope missing without failing
 * the test; write access stays "verified on first write".
 */
export function createAdoConnectionTester(options: AdoConnectionTesterOptions = {}): ConnectionTester<'ado'> {
  return async (draft, signal) => {
    const created = createAdoClient({
      orgUrl: draft.orgUrl,
      pat: draft.pat,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      // A test is interactive: one retry on 429/503, not the client's default three.
      retry: { maxRetries: 1 },
    });
    if (!created.ok) return { status: 'error', identity: null, message: created.message };

    const tested = await testAdoConnection(created.data, { defaultProject: draft.defaultProject ?? null, signal });
    if (!tested.ok) return { status: 'error', identity: null, message: tested.message };

    const { identity, projects, scopes, missingScopes } = tested.data;
    return { status: 'ok', identity: identity.displayName, message: null, missingScopes, scopes, projects };
  };
}
