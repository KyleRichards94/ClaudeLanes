import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { createAdoClient, type AdoClient, type AdoClientOptions, type AdoLogEntry } from '../client';
import { ORG_URL } from './constants';

/**
 * Test-only helpers for the ado-client unit tests. Not exported from the package; the shared MSW
 * handler set used across the app is `createFakeAdoOrg` in `./fake-org.ts` (AL-065).
 */
export { ORG_URL };

/** Shaped like a real 52-character PAT; valid nowhere. */
export const FAKE_PAT = 'fakepat7q2w9e4r1t6y3u8i5o0p2a7s4d9f1g6h3j8k5l0z2x7c4';
export const FAKE_AUTHORIZATION = `Basic ${btoa(`:${FAKE_PAT}`)}`;

/** One MSW server per test file; any request without a handler fails the test. */
export function useMswServer() {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());
  return server;
}

export interface TestClient {
  client: AdoClient;
  /** Every retry wait the client asked for, in ms. Waits resolve immediately. */
  sleeps: number[];
  logs: AdoLogEntry[];
}

export function createTestClient(overrides: Partial<AdoClientOptions> = {}): TestClient {
  const sleeps: number[] = [];
  const logs: AdoLogEntry[] = [];
  const created = createAdoClient({
    orgUrl: ORG_URL,
    pat: FAKE_PAT,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    log: (entry) => logs.push(entry),
    ...overrides,
  });
  if (!created.ok) throw new Error(`test client: ${created.message}`);
  return { client: created.data, sleeps, logs };
}
