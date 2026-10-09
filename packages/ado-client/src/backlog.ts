import {
  BACKLOG_PAGE_SIZE,
  ok,
  WorkItemIdSchema,
  type BacklogFilters,
  type BacklogGroup,
  type BacklogItem,
  type BacklogKind,
  type BacklogPage,
  type Result,
  type TeamRef,
} from '@agent-lanes/contracts';
import { z } from 'zod';
import type { AdoClient } from './client';
import { adoErr } from './errors';
import { adoPath } from './path';
import { callOptions, guarded, isName, missing, pointsOf, readItemsWithRelations, resolveTeam, teamFieldClause, toPerson, type RawBoardItem, type TeamCallOptions } from './team-board';
import { runWiql, wiqlString } from './wiql';

/**
 * The Backlog popout (AL-233, T6, TB§5): the team's backlog in backlog order, grouped by parent
 * Feature, a page at a time. Every filter becomes a WIQL clause, joined with AND, so ADO does the
 * filtering and the paging works on the filtered list. Never throws.
 */

export interface BacklogOptions extends TeamCallOptions {
  project: string;
  /** Team name or id. Omitted, the user's default team. */
  team?: string;
  filters?: BacklogFilters;
  /** Zero-based page and its size. Default the first page of {@link BACKLOG_PAGE_SIZE}. */
  page?: { index: number; size: number };
}

/** The most rows the backlog query returns; a backlog longer than this is cut off. */
export const BACKLOG_MAX_ITEMS = 5_000;
/** How far up the parent links a row is followed to find its Feature (task → story → feature). */
const MAX_PARENT_HOPS = 3;

const workItemTypesSchema = z.array(z.object({ name: z.string().min(1) })).nullish();
const backlogLevelSchema = z.object({ workItemTypes: workItemTypesSchema }).nullish();

const backlogConfigurationSchema = z.object({
  requirementBacklog: backlogLevelSchema,
  taskBacklog: backlogLevelSchema,
  portfolioBacklogs: z.array(z.object({ workItemTypes: workItemTypesSchema })).nullish(),
  bugWorkItems: backlogLevelSchema,
  backlogFields: z.object({ typeFields: z.record(z.string(), z.string()).nullish() }).nullish(),
  /** Per type, each state's category (`Proposed`, `InProgress`, `Resolved`, `Completed`, `Removed`). */
  workItemTypeMappedStates: z.array(z.object({ workItemTypeName: z.string(), states: z.record(z.string(), z.string()) })).nullish(),
});
type BacklogConfiguration = z.infer<typeof backlogConfigurationSchema>;

const teamSettingsSchema = z.object({
  backlogIteration: z.object({ id: z.string().nullish(), name: z.string().min(1), path: z.string().nullish() }),
});

const teamFieldValuesSchema = z.object({
  field: z.object({ referenceName: z.string().min(1) }),
  values: z.array(z.object({ value: z.string().min(1), includeChildren: z.boolean().nullish() })),
});

/** The order field when the configuration names none (Agile and CMMI). */
const DEFAULT_ORDER_FIELD = 'Microsoft.VSTS.Common.StackRank';
const PRIORITY_FIELD = 'Microsoft.VSTS.Common.Priority';

/** The pieces of the team's configuration the backlog query needs. */
interface BacklogSetup {
  team: TeamRef;
  types: Record<BacklogKind, string[]>;
  portfolioTypes: Set<string>;
  orderField: string;
  closedStates: string[];
  area: string | null;
  backlogIteration: string;
}

async function backlogSetup(client: AdoClient, project: string, team: TeamRef, call: TeamCallOptions): Promise<Result<BacklogSetup>> {
  const base = adoPath`/${project.trim()}/${team.id}/_apis/work`;
  const [configuration, settings, teamField] = await Promise.all([
    client.get(`${base}/backlogconfiguration`, backlogConfigurationSchema, call),
    client.get(`${base}/teamsettings`, teamSettingsSchema, call),
    client.get(`${base}/teamsettings/teamfieldvalues`, teamFieldValuesSchema, call),
  ]);
  if (!configuration.ok) return configuration;
  if (!settings.ok) return settings;
  if (!teamField.ok) return teamField;

  const config: BacklogConfiguration = configuration.data;
  const names = (level: z.infer<typeof backlogLevelSchema>) => (level?.workItemTypes ?? []).map((type) => type.name);
  const types = { story: names(config.requirementBacklog), bug: names(config.bugWorkItems), task: names(config.taskBacklog) };
  if (types.story.length === 0) return adoErr('INTERNAL', `${team.name} has no requirement backlog to list.`, { kind: 'unexpected' });

  const closedStates = new Set<string>();
  for (const mapping of config.workItemTypeMappedStates ?? []) {
    for (const [state, category] of Object.entries(mapping.states)) if (/^(completed|removed)$/i.test(category)) closedStates.add(state);
  }
  const backlogIteration = await backlogIterationPath(client, project, settings.data.backlogIteration, call);
  return ok({
    team,
    types,
    portfolioTypes: new Set((config.portfolioBacklogs ?? []).flatMap((level) => (level.workItemTypes ?? []).map((type) => type.name.toLowerCase()))),
    orderField: config.backlogFields?.typeFields?.['Order'] ?? DEFAULT_ORDER_FIELD,
    closedStates: [...closedStates],
    area: teamFieldClause(teamField.data),
    backlogIteration,
  });
}

const iterationNodeSchema: z.ZodType<IterationNode> = z.lazy(() =>
  z.object({
    identifier: z.string().nullish(),
    name: z.string(),
    path: z.string().nullish(),
    children: z.array(iterationNodeSchema).nullish(),
  }),
);
interface IterationNode {
  identifier?: string | null | undefined;
  name: string;
  path?: string | null | undefined;
  children?: IterationNode[] | null | undefined;
}

/** How deep the iteration tree is read when the backlog iteration's path has to be looked up. */
const ITERATION_TREE_DEPTH = 10;

/**
 * The team's backlog iteration as WIQL names it (`Development\Team Liink`). Azure DevOps Services
 * returns its `path` in the team settings; Azure DevOps Server (REST 6.x) leaves it out and gives only
 * the name and id, and WIQL refuses the bare name (TF51011). Then the id is looked up in the project's
 * iteration tree, whose `\Development\Iteration\Team Liink` paths drop the `Iteration` segment in
 * WIQL. If that read fails, `project\name` is the best guess. Never throws.
 */
export async function backlogIterationPath(
  client: AdoClient,
  project: string,
  iteration: { id?: string | null | undefined; name: string; path?: string | null | undefined },
  call: TeamCallOptions,
): Promise<string> {
  // ADO answers the root iteration with an empty path; work items name it by the project.
  const given = iteration.path?.replace(/^\\+/, '');
  if (given) return given;
  if (iteration.name.toLowerCase() === project.trim().toLowerCase()) return iteration.name;

  if (iteration.id) {
    const tree = await client.get(adoPath`/${project.trim()}/_apis/wit/classificationnodes/iterations`, iterationNodeSchema, {
      ...call,
      query: { $depth: ITERATION_TREE_DEPTH },
    });
    if (tree.ok) {
      const found = findNode(tree.data, iteration.id.toLowerCase());
      if (found?.path) return wiqlIterationPath(found.path);
    }
  }
  return `${project.trim()}\\${iteration.name}`;
}

function findNode(node: IterationNode, id: string): IterationNode | undefined {
  if (node.identifier?.toLowerCase() === id) return node;
  for (const child of node.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

/** `\Development\Iteration\Team Liink` → `Development\Team Liink`; the root `\Development\Iteration` → `Development`. */
export function wiqlIterationPath(nodePath: string): string {
  const segments = nodePath.split('\\').filter(Boolean);
  if (segments[1]?.toLowerCase() === 'iteration') segments.splice(1, 1);
  return segments.join('\\');
}

/** The backlog query: the team's open stories, bugs and tasks, every filter ANDed, in backlog order. */
export function backlogQuery(setup: Omit<BacklogSetup, 'team' | 'portfolioTypes'>, filters: BacklogFilters = {}): string {
  const kinds = filters.kinds && filters.kinds.length > 0 ? filters.kinds : (['story', 'bug', 'task'] as const);
  const types = [...new Set(kinds.flatMap((kind) => setup.types[kind]))];
  const clauses = [
    '[System.TeamProject] = @project',
    // A kind whose level has no types (bugs on the task backlog) matches nothing rather than everything.
    types.length > 0 ? `[System.WorkItemType] IN (${types.map(wiqlString).join(', ')})` : '[System.Id] = 0',
    ...setup.closedStates.map((state) => `[System.State] <> ${wiqlString(state)}`),
    `[System.IterationPath] ${filters.includeInSprint ? 'UNDER' : '='} ${wiqlString(setup.backlogIteration)}`,
    ...(setup.area ? [setup.area] : []),
  ];
  if (filters.priorities && filters.priorities.length > 0) clauses.push(`[${PRIORITY_FIELD}] IN (${filters.priorities.join(', ')})`);
  if (filters.areas && filters.areas.length > 0) clauses.push(`(${filters.areas.map((area) => `[System.AreaPath] UNDER ${wiqlString(area)}`).join(' OR ')})`);
  for (const tag of filters.tags ?? []) clauses.push(`[System.Tags] CONTAINS ${wiqlString(tag)}`);
  const text = filters.text?.trim();
  if (text) {
    const id = /^#?(\d{1,10})$/.exec(text)?.[1];
    const parsed = id === undefined ? undefined : WorkItemIdSchema.safeParse(Number(id)).data;
    const options = [`[System.Title] CONTAINS ${wiqlString(text)}`, `[System.Tags] CONTAINS ${wiqlString(text)}`, ...(parsed === undefined ? [] : [`[System.Id] = ${parsed}`])];
    clauses.push(`(${options.join(' OR ')})`);
  }
  return `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(' AND ')} ORDER BY [${setup.orderField}] ASC, [System.Id] ASC`;
}

/** One page of the team's backlog, grouped by Feature. */
export function getBacklog(client: AdoClient, options: BacklogOptions): Promise<Result<BacklogPage>> {
  return guarded('read the backlog', async () => {
    const { project } = options;
    if (!isName(project)) return missing('project', 'read its backlog');
    const call = callOptions(options);
    const index = options.page?.index ?? 0;
    const size = options.page?.size ?? BACKLOG_PAGE_SIZE;

    const team = await resolveTeam(client, project, options.team, call);
    if (!team.ok) return team;
    const setup = await backlogSetup(client, project, team.data, call);
    if (!setup.ok) return setup;

    const ids = await runWiql(client, { project, query: backlogQuery(setup.data, options.filters), top: BACKLOG_MAX_ITEMS, signal: call.signal });
    if (!ids.ok) return ids;
    const total = ids.data.length;
    const pageIds = ids.data.slice(index * size, (index + 1) * size);

    const rows = await readItemsWithRelations(client, pageIds, call);
    if (!rows.ok) return rows;
    const features = await featuresOf(client, rows.data, setup.data.portfolioTypes, call);
    if (!features.ok) return features;

    const items = rows.data.map((raw) => toBacklogItem(client.orgUrl, raw, setup.data));
    return ok({
      team: team.data,
      total,
      page: { index, size, count: Math.ceil(total / size) },
      groups: groupByFeature(items, features.data),
    });
  });
}

const parentSchema = z.object({
  id: WorkItemIdSchema,
  fields: z.object({ 'System.Title': z.string(), 'System.WorkItemType': z.string(), 'System.Parent': z.number().nullish() }).loose(),
});
const parentBatchSchema = z.object({ value: z.array(parentSchema.nullable()) });
type Feature = { id: number; title: string };

/** Each row's Feature: its parent, or grandparent, … that is a portfolio type, up to {@link MAX_PARENT_HOPS} links. */
async function featuresOf(client: AdoClient, rows: readonly RawBoardItem[], portfolioTypes: ReadonlySet<string>, call: TeamCallOptions): Promise<Result<Map<number, Feature | null>>> {
  const known = new Map<number, z.infer<typeof parentSchema>>();
  let wanted = new Set(rows.flatMap((row) => parentOf(row.fields) ?? []));
  for (let hop = 0; hop < MAX_PARENT_HOPS && wanted.size > 0; hop += 1) {
    const read = await client.request({
      method: 'POST',
      path: '/_apis/wit/workitemsbatch',
      body: { ids: [...wanted], fields: ['System.Title', 'System.WorkItemType', 'System.Parent'], errorPolicy: 'omit' },
      schema: parentBatchSchema,
      ...call,
    });
    if (!read.ok) return read;
    const next = new Set<number>();
    for (const parent of read.data.value) {
      if (!parent) continue;
      known.set(parent.id, parent);
      const up = parent.fields['System.Parent'];
      if (!portfolioTypes.has(parent.fields['System.WorkItemType'].toLowerCase()) && up && !known.has(up)) next.add(up);
    }
    wanted = next;
  }

  const features = new Map<number, Feature | null>();
  for (const row of rows) {
    let id = parentOf(row.fields);
    let feature: Feature | null = null;
    for (let hop = 0; hop < MAX_PARENT_HOPS && id; hop += 1) {
      const parent = known.get(id);
      if (!parent) break;
      if (portfolioTypes.has(parent.fields['System.WorkItemType'].toLowerCase())) {
        feature = { id: parent.id, title: parent.fields['System.Title'] };
        break;
      }
      id = parent.fields['System.Parent'] ?? undefined;
    }
    features.set(row.id, feature);
  }
  return ok(features);
}

function parentOf(fields: RawBoardItem['fields']): number | undefined {
  const parent = fields['System.Parent'];
  return typeof parent === 'number' && Number.isInteger(parent) && parent > 0 ? parent : undefined;
}

function toBacklogItem(orgUrl: string, raw: RawBoardItem, setup: BacklogSetup): BacklogItem {
  const { fields } = raw;
  const type = fields['System.WorkItemType'];
  const iterationPath = typeof fields['System.IterationPath'] === 'string' ? fields['System.IterationPath'] : '';
  const priority = fields[PRIORITY_FIELD];
  const project = fields['System.TeamProject'];
  return {
    id: raw.id,
    type,
    kind: kindOf(type, setup.types),
    title: fields['System.Title'],
    state: fields['System.State'],
    points: pointsOf(fields),
    priority: typeof priority === 'number' && Number.isInteger(priority) ? priority : null,
    tags: typeof fields['System.Tags'] === 'string' ? fields['System.Tags'].split(';').map((tag) => tag.trim()).filter(Boolean) : [],
    areaPath: typeof fields['System.AreaPath'] === 'string' ? fields['System.AreaPath'] : '',
    iterationPath,
    inSprint: iterationPath.toLowerCase() !== setup.backlogIteration.toLowerCase(),
    assignee: toPerson(fields['System.AssignedTo']),
    parentId: parentOf(fields) ?? null,
    webUrl: `${orgUrl}${adoPath`/${project}/_workitems/edit/${raw.id}`}`,
  };
}

function kindOf(type: string, types: Record<BacklogKind, string[]>): BacklogItem['kind'] {
  const lower = type.toLowerCase();
  for (const kind of ['story', 'bug', 'task'] as const) if (types[kind].some((name) => name.toLowerCase() === lower)) return kind;
  return 'other';
}

/** Rows in backlog order, gathered under their Feature; Features in order of their first row. */
export function groupByFeature(items: readonly BacklogItem[], features: ReadonlyMap<number, Feature | null>): BacklogGroup[] {
  const groups = new Map<number | null, BacklogGroup>();
  for (const item of items) {
    const feature = features.get(item.id) ?? null;
    const key = feature?.id ?? null;
    const group = groups.get(key) ?? { feature, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}
