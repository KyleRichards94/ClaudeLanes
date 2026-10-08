import {
  initialsOf,
  ok,
  pickSprint,
  WorkItemIdSchema,
  type Result,
  type TeamBoard,
  type TeamBoardColumn,
  type TeamBoardColumnKindOrOther,
  type TeamBoardItem,
  type TeamBoardPerson,
  type TeamList,
  type TeamRef,
} from '@agent-lanes/contracts';
import { z } from 'zod';
import type { AdoCallOptions, AdoClient } from './client';
import { adoErr } from './errors';
import { adoPath } from './path';
import { listSprints } from './sprints';
import { WIQL_MAX_TOP, runWiql, wiqlString } from './wiql';
import { WORK_ITEMS_BATCH_SIZE } from './work-items';

/**
 * The team board (AL-231, T1, TB§6): the user's teams, the team's board columns (Work › Boards API)
 * and the sprint's items on it. Every call goes through the client, so Azure DevOps Server gets the
 * api-version it speaks (AL-060's negotiation). Never throws.
 */

export type TeamCallOptions = Pick<AdoCallOptions, 'signal' | 'timeoutMs'>;

export interface TeamBoardOptions extends TeamCallOptions {
  project: string;
  /** Team name or id. Omitted, the default from {@link listMyTeams}. */
  team?: string;
  /** Sprint path or id. Omitted, the team's current sprint (`pickSprint`). */
  sprint?: string;
}

/** Teams per request with `$mine=true`. */
export const MY_TEAMS_PAGE_SIZE = 100;
/** Items one board read returns at most. */
export const TEAM_BOARD_MAX_ITEMS = 2_000;

const teamSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
const teamsSchema = z.object({ value: z.array(teamSchema) });
const projectSchema = z.object({ id: z.string().min(1), name: z.string().min(1), defaultTeam: teamSchema.nullish() });

/**
 * The user's teams in a project (`$mine=true`) and the one the board opens on: the project's default
 * team when the user is in it, else the first of the user's teams. A user in no team gets the project's
 * default team alone.
 */
export function listMyTeams(client: AdoClient, project: string, options: TeamCallOptions = {}): Promise<Result<TeamList>> {
  return guarded('list your teams', async () => {
    if (!isName(project)) return missing('project', 'list its teams');
    const call = callOptions(options);
    const [mine, details] = await Promise.all([
      client.get(adoPath`/_apis/projects/${project.trim()}/teams`, teamsSchema, { ...call, query: { $mine: true, $top: MY_TEAMS_PAGE_SIZE } }),
      client.get(adoPath`/_apis/projects/${project.trim()}`, projectSchema, call),
    ]);
    if (!mine.ok) return mine;
    if (!details.ok) return details;

    const teams = uniqueTeams(mine.data.value);
    const projectDefault = details.data.defaultTeam ?? null;
    if (teams.length === 0) return ok(projectDefault ? { teams: [toTeam(projectDefault)], defaultTeamId: projectDefault.id } : { teams: [], defaultTeamId: null });
    const fallback = teams.find((team) => sameText(team.id, projectDefault?.id)) ?? teams[0]!;
    return ok({ teams, defaultTeamId: fallback.id });
  });
}

// ── Board settings ──────────────────────────────────────────────────────────────────────────────

const backlogsSchema = z.object({
  value: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      type: z.string().nullish(),
    }),
  ),
});

const boardSchema = z.object({
  id: z.string().nullish(),
  name: z.string().nullish(),
  columns: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      /** `incoming` (first), `inProgress`, `outgoing` (Done). */
      columnType: z.string().nullish(),
      /** Work item type → state, one per type the board shows. */
      stateMappings: z.record(z.string(), z.string()).nullish(),
    }),
  ),
  fields: z
    .object({
      columnField: z.object({ referenceName: z.string().min(1) }).nullish(),
    })
    .nullish(),
});
type Board = z.infer<typeof boardSchema>;

const teamFieldValuesSchema = z.object({
  field: z.object({ referenceName: z.string().min(1) }),
  values: z.array(z.object({ value: z.string().min(1), includeChildren: z.boolean().nullish() })),
});

/** The fallback column field, when the board settings don't name the team's own `WEF_…_Kanban.Column`. */
export const BOARD_COLUMN_FIELD = 'System.BoardColumn';

/**
 * Which of the app's columns a board column is, from its type and name (the board's own name is
 * always what is shown). `done` for the board's last column, which the team board leaves out.
 */
export function boardColumnKind(column: { name: string; columnType?: string | null | undefined }): TeamBoardColumnKindOrOther | 'done' {
  const type = column.columnType?.toLowerCase();
  if (type === 'outgoing') return 'done';
  if (type === 'incoming') return 'to-do';
  const name = column.name.toLowerCase();
  if (/fail|reject|bounced|reopen/.test(name)) return 'failed';
  if (/review/.test(name)) return 'code-review';
  if (/test|\bqa\b|uat|verif/.test(name)) return 'testing';
  if (/progress|active|doing|develop|implement|build|committed/.test(name)) return 'in-progress';
  if (/to ?do|\bnew\b|backlog|ready|proposed|approved/.test(name)) return 'to-do';
  return 'other';
}

/** A WIQL clause matching the team's area paths (or whatever its team field is); null when it has none. */
export function teamFieldClause(teamField: z.infer<typeof teamFieldValuesSchema>): string | null {
  if (teamField.values.length === 0) return null;
  const field = `[${teamField.field.referenceName}]`;
  const parts = teamField.values.map(({ value, includeChildren }) => `${field} ${includeChildren ? 'UNDER' : '='} ${wiqlString(value)}`);
  return `(${parts.join(' OR ')})`;
}

/** Resolves a team by name or id, or the user's default team when none is named. */
export async function resolveTeam(client: AdoClient, project: string, team: string | undefined, options: TeamCallOptions = {}): Promise<Result<TeamRef>> {
  if (team === undefined) {
    const mine = await listMyTeams(client, project, options);
    if (!mine.ok) return mine;
    const chosen = mine.data.teams.find((candidate) => candidate.id === mine.data.defaultTeamId);
    return chosen ? ok(chosen) : adoErr('VALIDATION', `You are not in any team of ${project}, and it has no default team. Choose a team.`, { kind: 'config' });
  }
  if (!isName(team)) return missing('team', 'read its board');
  const found = await client.get(adoPath`/_apis/projects/${project.trim()}/teams/${team.trim()}`, teamSchema, callOptions(options));
  return found.ok ? ok(toTeam(found.data)) : found;
}

/** The team's settings for its board: area filter clause, requirement board and column field. */
async function boardSettings(client: AdoClient, project: string, team: TeamRef, call: TeamCallOptions): Promise<Result<{ board: Board; area: string | null }>> {
  const base = adoPath`/${project.trim()}/${team.id}/_apis/work`;
  const [backlogs, teamField] = await Promise.all([
    client.get(`${base}/backlogs`, backlogsSchema, call),
    client.get(`${base}/teamsettings/teamfieldvalues`, teamFieldValuesSchema, call),
  ]);
  if (!backlogs.ok) return backlogs;
  if (!teamField.ok) return teamField;

  const requirement = backlogs.data.value.find((level) => level.type?.toLowerCase() === 'requirement') ?? backlogs.data.value.find((level) => /requirement/i.test(level.id));
  if (!requirement) return adoErr('INTERNAL', `${team.name} has no requirement backlog, so it has no board to show.`, { kind: 'unexpected' });
  const board = await client.get(`${base}${adoPath`/boards/${requirement.name}`}`, boardSchema, call);
  if (!board.ok) return board;
  return ok({ board: board.data, area: teamFieldClause(teamField.data) });
}

// ── Items ───────────────────────────────────────────────────────────────────────────────────────

const identitySchema = z.object({ id: z.string().nullish(), displayName: z.string(), uniqueName: z.string().nullish() });
const relationSchema = z.object({ rel: z.string(), url: z.string(), attributes: z.object({ name: z.string().nullish() }).loose().nullish() });

/** A work item as `workitemsbatch` returns it with `$expand=relations` (every field). */
const rawBoardItemSchema = z.object({
  id: WorkItemIdSchema,
  fields: z
    .object({
      'System.Title': z.string(),
      'System.WorkItemType': z.string().min(1),
      'System.State': z.string(),
      'System.TeamProject': z.string().min(1),
      'System.AssignedTo': z.union([identitySchema, z.string()]).nullish(),
      'System.BoardColumn': z.string().nullish(),
      'Microsoft.VSTS.Scheduling.StoryPoints': z.number().nullish(),
      'Microsoft.VSTS.Scheduling.Effort': z.number().nullish(),
      'Microsoft.VSTS.Scheduling.Size': z.number().nullish(),
    })
    .loose(),
  relations: z.array(relationSchema).nullish(),
});
export type RawBoardItem = z.infer<typeof rawBoardItemSchema>;
const boardBatchSchema = z.object({ value: z.array(rawBoardItemSchema.nullable()) });

/** Reads `ids` with their links, in pages of 200, keeping their order and leaving out unreadable ids. */
export async function readItemsWithRelations(client: AdoClient, ids: readonly number[], call: TeamCallOptions = {}): Promise<Result<RawBoardItem[]>> {
  const found = new Map<number, RawBoardItem>();
  for (let start = 0; start < ids.length; start += WORK_ITEMS_BATCH_SIZE) {
    const page = await client.request({
      method: 'POST',
      path: '/_apis/wit/workitemsbatch',
      body: { ids: ids.slice(start, start + WORK_ITEMS_BATCH_SIZE), $expand: 'relations', errorPolicy: 'omit' },
      schema: boardBatchSchema,
      ...call,
    });
    if (!page.ok) return page;
    for (const item of page.data.value) if (item) found.set(item.id, item);
  }
  return ok(ids.flatMap((id) => found.get(id) ?? []));
}

/** The person on a card. API 7.x sends an identity object; older servers sent `"Name <name@domain>"`. */
export function toPerson(value: z.infer<typeof identitySchema> | string | null | undefined): TeamBoardPerson | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') {
    return { id: value.id ?? null, displayName: value.displayName, uniqueName: value.uniqueName ?? null, initials: initialsOf(value.displayName) };
  }
  const match = /^(.*?)\s*<([^<>]+)>$/.exec(value);
  const displayName = match ? match[1]! : value;
  return { id: null, displayName, uniqueName: match ? match[2]! : null, initials: initialsOf(displayName) };
}

/** Story points, effort or size: whichever the process uses. */
export function pointsOf(fields: RawBoardItem['fields']): number | null {
  return fields['Microsoft.VSTS.Scheduling.StoryPoints'] ?? fields['Microsoft.VSTS.Scheduling.Effort'] ?? fields['Microsoft.VSTS.Scheduling.Size'] ?? null;
}

const PULL_REQUEST_LINK = /^vstfs:\/\/\/Git\/PullRequestId\/(.+)$/i;
const BRANCH_LINK = /^vstfs:\/\/\/Git\/Ref\/(.+)$/i;

/** The newest linked pull request and the first linked branch, from a work item's `ArtifactLink`s. */
export function gitLinksOf(relations: RawBoardItem['relations']): { pullRequestId: number | null; branch: string | null } {
  let pullRequestId: number | null = null;
  let branch: string | null = null;
  for (const relation of relations ?? []) {
    if (relation.rel !== 'ArtifactLink') continue;
    const pr = PULL_REQUEST_LINK.exec(relation.url);
    if (pr) {
      const id = Number(pr[1]!.split(/%2F|\//i).at(-1));
      if (Number.isInteger(id) && id > 0 && (pullRequestId === null || id > pullRequestId)) pullRequestId = id;
      continue;
    }
    const ref = BRANCH_LINK.exec(relation.url);
    if (ref && branch === null) {
      // `{projectId}%2F{repositoryId}%2FGB{branch}`; a `/` inside the branch is `%2F` too.
      const [, , ...rest] = ref[1]!.split(/%2F/i);
      const name = safeDecode(rest.join('/'));
      if (name?.startsWith('GB') && name.length > 2) branch = name.slice(2);
    }
  }
  return { pullRequestId, branch };
}

/** A team's board for one sprint: its columns as the team named them, and the sprint's items on it. */
export function getTeamBoard(client: AdoClient, options: TeamBoardOptions): Promise<Result<TeamBoard>> {
  return guarded('read the team board', async () => {
    const { project, sprint: sprintKey } = options;
    if (!isName(project)) return missing('project', 'read its team board');
    const call = callOptions(options);

    const team = await resolveTeam(client, project, options.team, call);
    if (!team.ok) return team;
    const [sprints, settings] = await Promise.all([listSprints(client, { project, team: team.data.id }, call), boardSettings(client, project, team.data, call)]);
    if (!sprints.ok) return sprints;
    if (!settings.ok) return settings;

    const sprint =
      sprintKey === undefined
        ? pickSprint(sprints.data)
        : (sprints.data.sprints.find((candidate) => sameText(candidate.path, sprintKey) || sameText(candidate.id, sprintKey)) ?? null);
    if (!sprint) {
      return adoErr('VALIDATION', sprintKey === undefined ? `${team.data.name} has no sprints.` : `${sprintKey} is not one of ${team.data.name}'s sprints.`, { kind: 'config' });
    }

    const { board, area } = settings.data;
    const types = [...new Set(board.columns.flatMap((column) => Object.keys(column.stateMappings ?? {})))];
    const query = [
      'SELECT [System.Id] FROM WorkItems',
      'WHERE [System.TeamProject] = @project',
      `AND [System.IterationPath] = ${wiqlString(sprint.path)}`,
      ...(area ? [`AND ${area}`] : []),
      ...(types.length > 0 ? [`AND [System.WorkItemType] IN (${types.map(wiqlString).join(', ')})`] : []),
      'ORDER BY [System.Id] ASC',
    ].join(' ');
    const ids = await runWiql(client, { project, query, top: Math.min(TEAM_BOARD_MAX_ITEMS, WIQL_MAX_TOP), ...(call.signal ? { signal: call.signal } : {}) });
    if (!ids.ok) return ids;
    const raws = await readItemsWithRelations(client, ids.data, call);
    if (!raws.ok) return raws;

    const { columns, items } = placeItems(client.orgUrl, board, raws.data);
    return ok({ team: team.data, sprint: { id: sprint.id, name: sprint.name, path: sprint.path }, columns, items });
  });
}

/** Puts each item in its board column; a column only items name is added after the board's own. */
function placeItems(orgUrl: string, board: Board, raws: readonly RawBoardItem[]): { columns: TeamBoardColumn[]; items: TeamBoardItem[] } {
  const columnField = board.fields?.columnField?.referenceName ?? BOARD_COLUMN_FIELD;
  const columns: TeamBoardColumn[] = [];
  const done = new Set<string>();
  for (const column of board.columns) {
    const kind = boardColumnKind(column);
    if (kind === 'done') done.add(column.name.toLowerCase());
    else columns.push({ id: column.id, name: column.name, kind });
  }
  const incoming = columns[0];

  const items: TeamBoardItem[] = [];
  for (const raw of raws) {
    const { fields } = raw;
    const named = stringField(fields[columnField]) ?? fields['System.BoardColumn'] ?? null;
    if (named && done.has(named.toLowerCase())) continue;
    let column = named ? columns.find((candidate) => sameText(candidate.name, named)) : incoming;
    if (!column && named) {
      // Unknown columns are shown, not dropped (AL-231).
      column = { id: `unknown:${named}`, name: named, kind: boardColumnKind({ name: named }) as TeamBoardColumnKindOrOther };
      columns.push(column);
    }
    if (!column) continue;
    const project = fields['System.TeamProject'];
    items.push({
      id: raw.id,
      type: fields['System.WorkItemType'],
      title: fields['System.Title'],
      state: fields['System.State'],
      points: pointsOf(fields),
      columnId: column.id,
      column: column.name,
      columnKind: column.kind,
      assignee: toPerson(fields['System.AssignedTo']),
      ...gitLinksOf(raw.relations),
      webUrl: `${orgUrl}${adoPath`/${project}/_workitems/edit/${raw.id}`}`,
    });
  }
  const order = new Map(columns.map((column, index) => [column.id, index]));
  items.sort((a, b) => order.get(a.columnId)! - order.get(b.columnId)! || a.id - b.id);
  return { columns, items };
}

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────────

function uniqueTeams(teams: ReadonlyArray<z.infer<typeof teamSchema>>): TeamRef[] {
  const seen = new Map<string, TeamRef>();
  for (const team of teams) if (!seen.has(team.id)) seen.set(team.id, toTeam(team));
  return [...seen.values()];
}

function toTeam({ id, name }: z.infer<typeof teamSchema>): TeamRef {
  return { id, name };
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function sameText(a: string | null | undefined, b: string | null | undefined): boolean {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

export function callOptions({ signal, timeoutMs }: TeamCallOptions): TeamCallOptions {
  return { ...(signal ? { signal } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
}

export function isName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function missing(what: 'project' | 'team', purpose: string) {
  return adoErr('VALIDATION', `A ${what} name or id is needed to ${purpose}.`, { kind: 'config' });
}

export async function guarded<T>(purpose: string, fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch (cause) {
    return adoErr('INTERNAL', `Azure DevOps failed unexpectedly while trying to ${purpose}.`, {
      kind: 'unexpected',
      cause: cause instanceof Error ? cause.message : String(cause),
    });
  }
}
