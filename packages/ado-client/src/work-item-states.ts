import { ok, type Result, type WorkItemStateCategory } from '@agent-lanes/contracts';
import { z } from 'zod';
import type { AdoClient } from './client';
import { adoPath } from './path';

/** A work item type's states in one project: state name (lower-cased) → category. */
type StateCategoryMap = ReadonlyMap<string, WorkItemStateCategory>;

/** What a work item needs to be coloured. */
export interface StateRef {
  project: string;
  type: string;
  state: string;
}

export type StateCategoryOf = (item: StateRef) => WorkItemStateCategory;

/** `GET {project}/_apis/wit/workitemtypes/{type}/states`: `{ count, value: [{ name, color, category }] }`. */
const statesSchema = z.object({
  value: z.array(z.object({ name: z.string(), category: z.string().nullish() })),
});

/** ADO category names, lower-cased without separators, to ours. */
const CATEGORIES: ReadonlyMap<string, WorkItemStateCategory> = new Map([
  ['proposed', 'proposed'],
  ['inprogress', 'in-progress'],
  ['resolved', 'resolved'],
  ['completed', 'completed'],
  ['removed', 'removed'],
]);

/** Maps ADO's state category (`Proposed`, `InProgress`, …) to the DTO's; anything else is `unknown`. */
export function toStateCategory(adoCategory: string | null | undefined): WorkItemStateCategory {
  if (!adoCategory) return 'unknown';
  return CATEGORIES.get(adoCategory.replace(/[\s_-]/g, '').toLowerCase()) ?? 'unknown';
}

/**
 * State lists change only when someone edits the process, so they are read once per client, project
 * and type and kept for the client's lifetime (in memory, R2). A state missing from a kept list means
 * the process changed: that list is read again. Failed reads are not kept.
 */
const caches = new WeakMap<AdoClient, Map<string, Promise<Result<StateCategoryMap>>>>();

function cacheFor(client: AdoClient): Map<string, Promise<Result<StateCategoryMap>>> {
  let cache = caches.get(client);
  if (!cache) {
    cache = new Map();
    caches.set(client, cache);
  }
  return cache;
}

async function fetchStates(client: AdoClient, project: string, type: string): Promise<Result<StateCategoryMap>> {
  // No caller signal: the read is shared by every concurrent caller, so one caller's cancel must not
  // fail the others. The client's timeout still bounds it.
  const result = await client.get(adoPath`/${project}/_apis/wit/workitemtypes/${type}/states`, statesSchema);
  if (!result.ok) return result;
  return ok(new Map(result.data.value.map((state) => [state.name.toLowerCase(), toStateCategory(state.category)])));
}

async function stateCategories(client: AdoClient, project: string, type: string, states: ReadonlySet<string>): Promise<Result<StateCategoryMap>> {
  const cache = cacheFor(client);
  const key = `${project.toLowerCase()}\n${type.toLowerCase()}`;
  const kept = cache.get(key);
  if (kept) {
    const result = await kept;
    if (!result.ok || [...states].every((state) => result.data.has(state))) return result;
  }
  const pending = fetchStates(client, project, type);
  cache.set(key, pending);
  const result = await pending;
  if (!result.ok && cache.get(key) === pending) cache.delete(key);
  return result;
}

/**
 * Reads the state categories the given work items need, one request per project and type not seen
 * before. Colour is not worth failing a list over: a failed read leaves those items `unknown`,
 * except a credential failure (401, 403, sign-in page), which is returned so the caller can ask the
 * user to reconnect (design §8).
 */
export async function resolveStateCategories(client: AdoClient, items: ReadonlyArray<StateRef>): Promise<Result<StateCategoryOf>> {
  const groups = new Map<string, { project: string; type: string; states: Set<string> }>();
  for (const item of items) {
    const key = `${item.project.toLowerCase()}\n${item.type.toLowerCase()}`;
    const group = groups.get(key) ?? { project: item.project, type: item.type, states: new Set<string>() };
    group.states.add(item.state.toLowerCase());
    groups.set(key, group);
  }

  const maps = new Map<string, StateCategoryMap>();
  const results = await Promise.all(
    [...groups].map(async ([key, group]) => {
      const result = await stateCategories(client, group.project, group.type, group.states);
      if (result.ok) maps.set(key, result.data);
      return result;
    }),
  );
  for (const result of results) {
    if (!result.ok && (result.code === 'ADO_UNAUTHORIZED' || result.code === 'ADO_SCOPE_MISSING')) return result;
  }

  return ok((item) => maps.get(`${item.project.toLowerCase()}\n${item.type.toLowerCase()}`)?.get(item.state.toLowerCase()) ?? 'unknown');
}
