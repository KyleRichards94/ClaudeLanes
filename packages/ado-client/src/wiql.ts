import { ok, type Result } from '@agent-lanes/contracts';
import { z } from 'zod';
import type { AdoClient } from './client';
import { adoPath } from './path';

/** WIQL answers at most this many ids; ask for more and ADO fails the query (VS402337). */
export const WIQL_MAX_TOP = 20_000;

/**
 * A WIQL string literal. WIQL has no backslash escapes: a quote inside the value is doubled, so
 * `O'Brien` becomes `'O''Brien'` and no user text can close the literal and add clauses.
 */
export function wiqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

/** `{ queryType: 'flat', workItems: [{ id, url }], … }`; only the ids are used. */
const wiqlResultSchema = z.object({
  workItems: z.array(z.object({ id: z.int().positive() })),
});

export interface RunWiqlOptions {
  /** Project the query runs in; `@project` resolves to it. */
  project: string;
  /** `SELECT [System.Id] FROM WorkItems WHERE …` (a flat work item query). */
  query: string;
  /** Sent as `$top`; at most {@link WIQL_MAX_TOP}. */
  top: number;
  signal?: AbortSignal;
}

/** Runs a flat WIQL query and returns the matching ids in the query's ORDER BY order. */
export async function runWiql(client: AdoClient, options: RunWiqlOptions): Promise<Result<number[]>> {
  const result = await client.request({
    method: 'POST',
    path: adoPath`/${options.project}/_apis/wit/wiql`,
    query: { $top: options.top },
    body: { query: options.query },
    schema: wiqlResultSchema,
    signal: options.signal,
  });
  return result.ok ? ok(result.data.workItems.map((item) => item.id)) : result;
}
