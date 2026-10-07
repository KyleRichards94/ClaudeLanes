import { z } from 'zod';
import { createAdoClient, type FetchLike } from '@agent-lanes/ado-client';
import type { ConnectionTester } from './testers';

/** Connection Data is a preview API in REST 7.1 (Location area). */
export const CONNECTION_DATA_API_VERSION = '7.1-preview.1';

const ConnectionDataSchema = z.object({
  authenticatedUser: z.object({
    id: z.string(),
    providerDisplayName: z.string().optional(),
    customDisplayName: z.string().optional(),
  }),
});

export interface AdoConnectionTesterOptions {
  /** Defaults to the global `fetch`; tests pass a fake. */
  fetch?: FetchLike;
}

/**
 * Tests an ADO organisation the way design §8 says: `GET {org}/_apis/connectionData` with the PAT,
 * which answers with the signed-in identity, or 401 for a bad token. The scope probes (Work Items,
 * Code, Build), the project list for "Default project" and the expiry come with AL-043.
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

    const answer = await created.data.get('/_apis/connectionData', ConnectionDataSchema, {
      apiVersion: CONNECTION_DATA_API_VERSION,
      signal,
    });
    if (!answer.ok) return { status: 'error', identity: null, message: answer.message };

    const user = answer.data.authenticatedUser;
    return { status: 'ok', identity: user.customDisplayName || user.providerDisplayName || null, message: null };
  };
}
