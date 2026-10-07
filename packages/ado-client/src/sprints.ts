import { ok, type AdoTeam, type Result, type Sprint, type SprintList, type SprintTimeFrame } from '@agent-lanes/contracts';
import { z } from 'zod';
import type { AdoCallOptions, AdoClient } from './client';
import { DEFAULT_MAX_PAGES } from './constants';
import { adoErr } from './errors';
import { adoPath } from './path';

/**
 * Teams and sprints (AL-061, design §7). A sprint is an iteration the team has selected in its
 * settings (`_apis/work/teamsettings/iterations`); which one is current comes from
 * `$timeframe=current`.
 */

/** Which team's sprints to read. */
export interface TeamScope {
  /** Project name or id. */
  project: string;
  /** Team name or id. Omitted, ADO uses the project's default team. */
  team?: string;
}

export type SprintCallOptions = Pick<AdoCallOptions, 'signal' | 'timeoutMs'>;

export interface ListSprintsOptions extends SprintCallOptions {
  /**
   * Clock used only when ADO leaves out an iteration's time frame and it has to be worked out from
   * the dates. Defaults to `Date.now`.
   */
  now?: () => number;
}

/** Teams per request; the Teams API pages with `$top`/`$skip`, not continuation tokens. */
export const TEAMS_PAGE_SIZE = 100;

const teamsPageSchema = z.object({
  value: z.array(z.object({ id: z.string().min(1), name: z.string().min(1) })),
});

/** `2026-10-07T00:00:00Z` → `2026-10-07`. ADO sends sprint dates as midnight UTC ("date-only"). */
const adoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(?:T|$)/)
  .transform((value) => value.slice(0, 10))
  .pipe(z.iso.date());

const iterationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
  attributes: z
    .object({
      startDate: adoDateSchema.nullish(),
      finishDate: adoDateSchema.nullish(),
      // Read leniently: anything but past/current/future is worked out from the dates instead.
      timeFrame: z.unknown().optional(),
    })
    .nullish(),
});
type Iteration = z.infer<typeof iterationSchema>;

/** `$timeframe=current` answers may leave out `path`; only the id is needed from them. */
const currentIterationSchema = iterationSchema.extend({ path: z.string().min(1).optional() });
type CurrentIteration = z.infer<typeof currentIterationSchema>;

/** ADO answers `{ count, value: [...] }`; the 7.1 docs' sample shows `values`, so both are read. */
function iterationListSchema<T extends z.ZodType>(item: T) {
  return z.union([
    z.object({ value: z.array(item) }).transform((body) => body.value),
    z.object({ values: z.array(item) }).transform((body) => body.values),
  ]);
}

const iterationsSchema = iterationListSchema(iterationSchema);
const currentIterationsSchema = iterationListSchema(currentIterationSchema);

/**
 * Every team in a project, in the order ADO returns them, following `$top`/`$skip` pages.
 * Never throws; a failing page fails the whole call.
 */
export async function listTeams(client: AdoClient, project: string, options: SprintCallOptions = {}): Promise<Result<AdoTeam[]>> {
  if (!isName(project)) return missing('project', 'list its teams');

  const path = adoPath`/_apis/projects/${project.trim()}/teams`;
  const teams = new Map<string, AdoTeam>();
  for (let page = 0; page < DEFAULT_MAX_PAGES; page += 1) {
    const received = await client.get(path, teamsPageSchema, {
      ...callOptions(options),
      query: { $top: TEAMS_PAGE_SIZE, $skip: page * TEAMS_PAGE_SIZE },
    });
    if (!received.ok) return received;

    // A team added between two pages shifts the rest along by one; keep the first copy.
    for (const { id, name } of received.data.value) if (!teams.has(id)) teams.set(id, { id, name });
    if (received.data.value.length < TEAMS_PAGE_SIZE) return ok([...teams.values()]);
  }
  return adoErr('INTERNAL', `Listing the teams of a project needed more than ${DEFAULT_MAX_PAGES} pages; stopped.`, {
    kind: 'paging',
    method: 'GET',
    attempts: DEFAULT_MAX_PAGES,
  });
}

/**
 * A team's sprints, past, current and future, oldest first (undated ones last), with the current one
 * marked from `$timeframe=current`. The board pre-selects it with `pickSprint` from contracts.
 * Never throws.
 */
export async function listSprints(client: AdoClient, scope: TeamScope, options: ListSprintsOptions = {}): Promise<Result<SprintList>> {
  if (!isName(scope.project)) return missing('project', 'list its sprints');
  if (scope.team !== undefined && !isName(scope.team)) return missing('team', 'list its sprints');

  const path = iterationsPath(scope);
  const call = callOptions(options);
  const [all, current] = await Promise.all([
    client.get(path, iterationsSchema, call),
    client.get(path, currentIterationsSchema, { ...call, query: { $timeframe: 'current' } }),
  ]);
  if (!all.ok) return all;
  if (!current.ok) return current;

  const iterations: Iteration[] = [...all.data];
  const currentIteration = current.data[0];
  if (currentIteration && !iterations.some((iteration) => iteration.id === currentIteration.id) && hasPath(currentIteration)) {
    // Selected for the team between the two requests: still show it.
    iterations.push(currentIteration);
  }
  const currentId = currentIteration && iterations.some((iteration) => iteration.id === currentIteration.id) ? currentIteration.id : null;

  const today = calendarDay(options.now?.() ?? Date.now());
  const currentStart = iterations.find((iteration) => iteration.id === currentId)?.attributes?.startDate ?? null;
  const sprints = iterations.map((iteration) => toSprint(iteration, currentId, currentStart ?? today)).toSorted(byStart);
  return ok({ sprints, currentId });
}

function toSprint(iteration: Iteration, currentId: string | null, reference: string): Sprint {
  const start = iteration.attributes?.startDate ?? null;
  const finish = iteration.attributes?.finishDate ?? null;
  return { id: iteration.id, name: iteration.name, path: iteration.path, start, finish, timeFrame: timeFrameOf(iteration, currentId, reference) };
}

/**
 * The current sprint is the one `$timeframe=current` named. Others keep ADO's past/future; when ADO
 * left it out (or also calls this one current), it is past if it ended before `reference` (the
 * current sprint's start, or today), otherwise future.
 */
function timeFrameOf(iteration: Iteration, currentId: string | null, reference: string): SprintTimeFrame {
  if (iteration.id === currentId) return 'current';
  const reported = iteration.attributes?.timeFrame;
  if (reported === 'past' || reported === 'future') return reported;
  const end = iteration.attributes?.finishDate ?? iteration.attributes?.startDate ?? null;
  return end !== null && end < reference ? 'past' : 'future';
}

/** Oldest first by start date; undated sprints keep ADO's order after the dated ones. */
function byStart(a: Sprint, b: Sprint): number {
  if (a.start === b.start) return 0;
  if (a.start === null) return 1;
  if (b.start === null) return -1;
  return a.start < b.start ? -1 : 1;
}

function iterationsPath({ project, team }: TeamScope): string {
  return team === undefined
    ? adoPath`/${project.trim()}/_apis/work/teamsettings/iterations`
    : adoPath`/${project.trim()}/${team.trim()}/_apis/work/teamsettings/iterations`;
}

function hasPath(iteration: CurrentIteration): iteration is Iteration {
  return typeof iteration.path === 'string';
}

/** Local calendar day, `YYYY-MM-DD`. */
function calendarDay(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function callOptions({ signal, timeoutMs }: SprintCallOptions): SprintCallOptions {
  return { ...(signal ? { signal } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function missing(what: 'project' | 'team', purpose: string) {
  return adoErr('VALIDATION', `A ${what} name or id is needed to ${purpose}.`, { kind: 'config' });
}
