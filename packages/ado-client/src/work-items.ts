import { ok, WorkItemIdSchema, type Result, type WorkItem, type WorkItemAssignee } from '@agent-lanes/contracts';
import { z } from 'zod';
import type { AdoClient } from './client';
import { adoErr, formatIssues } from './errors';
import { adoPath } from './path';
import { WIQL_MAX_TOP, runWiql, wiqlString } from './wiql';
import { resolveStateCategories } from './work-item-states';

/**
 * Work items for the New agent ticket modal and the ticket drill-in (AL-062, artboards 2 and 3):
 * a sprint's stories, bugs and tasks; search by id or title; one item by id. Every call returns
 * `Result<WorkItem[]>` / `Result<WorkItem>` and never throws.
 */

/** Fields read for every work item. `System.TeamProject` builds the web URL and finds the state categories. */
export const WORK_ITEM_FIELDS = [
  'System.Id',
  'System.Title',
  'System.WorkItemType',
  'System.State',
  'System.AssignedTo',
  'System.IterationPath',
  'System.TeamProject',
  'System.Description',
  'Microsoft.VSTS.Common.AcceptanceCriteria',
] as const;

/**
 * The default type filter: stories, bugs and tasks in any process, by ADO's type categories
 * (User Story / Product Backlog Item / Requirement / Issue, Bug, Task), so no process's type
 * names are hard-coded. Pass `types` to name the types instead.
 */
export const DEFAULT_WORK_ITEM_CATEGORIES = ['Microsoft.RequirementCategory', 'Microsoft.BugCategory', 'Microsoft.TaskCategory'] as const;

/** `workitemsbatch` takes at most 200 ids per request; longer lists go in pages of this size. */
export const WORK_ITEMS_BATCH_SIZE = 200;
export const DEFAULT_SPRINT_MAX_ITEMS = 2_000;
export const DEFAULT_SEARCH_TOP = 50;
export const SEARCH_TOP_MAX = 200;
export const SEARCH_QUERY_MAX_LENGTH = 256;

export interface ListSprintWorkItemsOptions {
  project: string;
  /** The sprint's `System.IterationPath`, e.g. `OnSite Companion\Sprint 42` (a sprint's `path`, AL-061). */
  iterationPath: string;
  /** Work item type names to include ("User Story", "Bug"). Default: {@link DEFAULT_WORK_ITEM_CATEGORIES}. */
  types?: readonly string[];
  /** Most items returned, lowest ids first. Default 2 000; at most 20 000 (WIQL's limit). */
  maxItems?: number;
  signal?: AbortSignal;
}

export interface SearchWorkItemsOptions {
  project: string;
  /** A work item id ("71273", "#71273") or part of a title ("frmJobControl"). Blank returns no items without a request. */
  query: string;
  /** Types the title search includes; an exact id match is returned whatever its type. Default: {@link DEFAULT_WORK_ITEM_CATEGORIES}. */
  types?: readonly string[];
  /** Most items returned: the exact id match first, then title matches, most recently changed first. Default 50, at most 200. */
  top?: number;
  signal?: AbortSignal;
}

export interface GetWorkItemOptions {
  id: number;
  signal?: AbortSignal;
}

export interface GetWorkItemsOptions {
  /** Returned in this order, duplicates once; ids that don't exist or can't be read are left out. */
  ids: readonly number[];
  signal?: AbortSignal;
}

/**
 * Stories, bugs and tasks in one sprint (iteration path), lowest id first. WIQL finds the ids, then
 * `workitemsbatch` reads them in pages of 200, so a sprint of any size up to `maxItems` comes back whole.
 */
export function listSprintWorkItems(client: AdoClient, options: ListSprintWorkItemsOptions): Promise<Result<WorkItem[]>> {
  return guarded(async () => {
    const parsed = parseOptions(sprintOptionsSchema, options, 'listSprintWorkItems');
    if (!parsed.ok) return parsed;
    const { project, iterationPath, types, maxItems } = parsed.data;

    const query = [
      'SELECT [System.Id] FROM WorkItems',
      'WHERE [System.TeamProject] = @project',
      `AND [System.IterationPath] = ${wiqlString(iterationPath)}`,
      `AND ${typeFilter(types)}`,
      'ORDER BY [System.Id] ASC',
    ].join(' ');
    const ids = await runWiql(client, { project, query, top: maxItems, signal: options.signal });
    if (!ids.ok) return ids;
    return readWorkItems(client, ids.data, options.signal);
  });
}

/**
 * Searches one project by work item id or title (`CONTAINS`, case-insensitive). A numeric query
 * ("71273" or "#71273") also matches that id exactly, listed first; title matches follow, most
 * recently changed first.
 */
export function searchWorkItems(client: AdoClient, options: SearchWorkItemsOptions): Promise<Result<WorkItem[]>> {
  return guarded(async () => {
    const parsed = parseOptions(searchOptionsSchema, options, 'searchWorkItems');
    if (!parsed.ok) return parsed;
    const { project, query, types, top } = parsed.data;
    if (query === '') return ok([]);

    const digits = /^#?(\d+)$/.exec(query)?.[1];
    const id = digits === undefined ? undefined : WorkItemIdSchema.safeParse(Number(digits)).data;
    const signal = options.signal;

    const byTitle = runWiql(client, {
      project,
      query: [
        'SELECT [System.Id] FROM WorkItems',
        'WHERE [System.TeamProject] = @project',
        `AND ${typeFilter(types)}`,
        `AND [System.Title] CONTAINS ${wiqlString(digits ?? query)}`,
        'ORDER BY [System.ChangedDate] DESC',
      ].join(' '),
      top,
      signal,
    });
    // Its own query, so title matches can't push the exact match past `top`.
    const byId =
      id === undefined
        ? Promise.resolve(ok<number[]>([]))
        : runWiql(client, { project, query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Id] = ${id}`, top: 1, signal });

    const [idMatches, titleMatches] = await Promise.all([byId, byTitle]);
    if (!idMatches.ok) return idMatches;
    if (!titleMatches.ok) return titleMatches;
    const ids = [...new Set([...idMatches.data, ...titleMatches.data])].slice(0, top);
    return readWorkItems(client, ids, signal);
  });
}

/** One work item by id, in any project of the organisation. A missing or unreadable id fails with ADO's 404 (`INTERNAL`, `details.status` 404). */
export function getWorkItem(client: AdoClient, options: GetWorkItemOptions): Promise<Result<WorkItem>> {
  return guarded(async () => {
    const parsed = parseOptions(z.object({ id: WorkItemIdSchema }), options, 'getWorkItem');
    if (!parsed.ok) return parsed;

    const raw = await client.get(adoPath`/_apis/wit/workitems/${parsed.data.id}`, rawWorkItemSchema, {
      query: { fields: WORK_ITEM_FIELDS },
      signal: options.signal,
    });
    if (!raw.ok) return raw;
    const items = await toWorkItems(client, [raw.data]);
    if (!items.ok) return items;
    return ok(items.data[0]!);
  });
}

/** Several work items by id, in pages of 200 (e.g. the board refreshing every card's ADO state, R6). */
export function getWorkItems(client: AdoClient, options: GetWorkItemsOptions): Promise<Result<WorkItem[]>> {
  return guarded(async () => {
    const parsed = parseOptions(z.object({ ids: z.array(WorkItemIdSchema) }), options, 'getWorkItems');
    if (!parsed.ok) return parsed;
    return readWorkItems(client, [...new Set(parsed.data.ids)], options.signal);
  });
}

// ── Request options ──────────────────────────────────────────────────────────────────────────────

/** Text that goes into a WIQL literal or a path: no control characters (a newline can't end a WIQL clause either). */
const text = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((value) => !/\p{Cc}/u.test(value), 'must not contain control characters');

const projectSchema = text(256);
const typesSchema = z.array(text(128)).min(1).max(50).optional();

const sprintOptionsSchema = z.object({
  project: projectSchema,
  iterationPath: text(1_024),
  types: typesSchema,
  maxItems: z.int().min(1).max(WIQL_MAX_TOP).default(DEFAULT_SPRINT_MAX_ITEMS),
});

const searchOptionsSchema = z.object({
  project: projectSchema,
  query: text(SEARCH_QUERY_MAX_LENGTH, 0),
  types: typesSchema,
  top: z.int().min(1).max(SEARCH_TOP_MAX).default(DEFAULT_SEARCH_TOP),
});

function parseOptions<S extends z.ZodType>(schema: S, options: unknown, call: string): Result<z.output<S>> {
  const parsed = schema.safeParse(options);
  if (parsed.success) return ok(parsed.data);
  const issues = formatIssues(parsed.error);
  const summary = issues.map((issue) => `${issue.path.replace(/^\$\.?/, '') || 'options'} ${issue.message}`).join('; ');
  return adoErr('VALIDATION', `${call}: ${summary}.`, { kind: 'config', issues });
}

/** `[System.WorkItemType] IN ('User Story', 'Bug')`, or the default categories with `IN GROUP`. */
function typeFilter(types: readonly string[] | undefined): string {
  if (types !== undefined) return `[System.WorkItemType] IN (${types.map(wiqlString).join(', ')})`;
  return `(${DEFAULT_WORK_ITEM_CATEGORIES.map((category) => `[System.WorkItemType] IN GROUP ${wiqlString(category)}`).join(' OR ')})`;
}

// ── Reading and mapping ──────────────────────────────────────────────────────────────────────────

const identitySchema = z.object({ displayName: z.string(), uniqueName: z.string().nullish() });

/** A work item as `workitems` / `workitemsbatch` return it with `fields=WORK_ITEM_FIELDS`. Empty fields are left out by ADO. */
const rawWorkItemSchema = z.object({
  id: WorkItemIdSchema,
  fields: z.object({
    'System.Title': z.string(),
    'System.WorkItemType': z.string().min(1),
    'System.State': z.string(),
    'System.AssignedTo': z.union([identitySchema, z.string()]).nullish(),
    'System.IterationPath': z.string(),
    'System.TeamProject': z.string().min(1),
    'System.Description': z.string().nullish(),
    'Microsoft.VSTS.Common.AcceptanceCriteria': z.string().nullish(),
  }),
});
type RawWorkItem = z.infer<typeof rawWorkItemSchema>;

/** With `errorPolicy: 'omit'`, an id that doesn't exist or can't be read comes back as null. */
const batchSchema = z.object({ value: z.array(rawWorkItemSchema.nullable()) });

/** Reads `ids` in pages of {@link WORK_ITEMS_BATCH_SIZE}, keeping their order and leaving out unreadable ids. */
async function readWorkItems(client: AdoClient, ids: readonly number[], signal: AbortSignal | undefined): Promise<Result<WorkItem[]>> {
  const found = new Map<number, RawWorkItem>();
  for (let start = 0; start < ids.length; start += WORK_ITEMS_BATCH_SIZE) {
    const page = await client.request({
      method: 'POST',
      path: '/_apis/wit/workitemsbatch',
      body: { ids: ids.slice(start, start + WORK_ITEMS_BATCH_SIZE), fields: WORK_ITEM_FIELDS, errorPolicy: 'omit' },
      schema: batchSchema,
      signal,
    });
    if (!page.ok) return page;
    for (const item of page.data.value) if (item) found.set(item.id, item);
  }
  return toWorkItems(client, ids.flatMap((id) => found.get(id) ?? []));
}

async function toWorkItems(client: AdoClient, raws: readonly RawWorkItem[]): Promise<Result<WorkItem[]>> {
  const refs = raws.map(({ fields }) => ({ project: fields['System.TeamProject'], type: fields['System.WorkItemType'], state: fields['System.State'] }));
  const categoryOf = await resolveStateCategories(client, refs);
  if (!categoryOf.ok) return categoryOf;

  return ok(
    raws.map(({ id, fields }, index): WorkItem => {
      const project = fields['System.TeamProject'];
      return {
        id,
        project,
        type: fields['System.WorkItemType'],
        title: fields['System.Title'],
        state: fields['System.State'],
        stateCategory: categoryOf.data(refs[index]!),
        assignedTo: toAssignee(fields['System.AssignedTo']),
        iterationPath: fields['System.IterationPath'],
        description: nonBlank(fields['System.Description']),
        acceptanceCriteria: nonBlank(fields['Microsoft.VSTS.Common.AcceptanceCriteria']),
        webUrl: `${client.orgUrl}${adoPath`/${project}/_workitems/edit/${id}`}`,
      };
    }),
  );
}

/** API 7.x sends an identity object; older servers sent `"Display Name <name@domain>"`. */
function toAssignee(value: z.infer<typeof identitySchema> | string | null | undefined): WorkItemAssignee | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return { displayName: value.displayName, uniqueName: value.uniqueName ?? null };
  const match = /^(.*?)\s*<([^<>]+)>$/.exec(value);
  return match ? { displayName: match[1]!, uniqueName: match[2]! } : { displayName: value, uniqueName: null };
}

function nonBlank(value: string | null | undefined): string | null {
  return value && value.trim() !== '' ? value : null;
}

async function guarded<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (cause) {
    return adoErr('INTERNAL', 'Reading Azure DevOps work items failed unexpectedly.', {
      kind: 'unexpected',
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
