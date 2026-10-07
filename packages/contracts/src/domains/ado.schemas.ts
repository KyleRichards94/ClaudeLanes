import { z } from 'zod';
import type { InvokeContract } from '../contract';
import type { ADO_EVENT_CHANNELS, ADO_INVOKE_CHANNELS } from './ado.names';

// ── Sprints (AL-061) ──────────────────────────────────────────────────────────

/** Where a sprint sits relative to today, as ADO's team settings report it. */
export const SPRINT_TIME_FRAMES = ['past', 'current', 'future'] as const;
export const SprintTimeFrameSchema = z.enum(SPRINT_TIME_FRAMES);
export type SprintTimeFrame = z.infer<typeof SprintTimeFrameSchema>;

/** A team in an ADO project. Sprints are chosen per team (AL-061). */
export const AdoTeamSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
});
export type AdoTeam = z.infer<typeof AdoTeamSchema>;

/**
 * One sprint: an ADO iteration selected for a team, as the board's Sprint dropdown and sub-header
 * use it ("Sprint 42 · 7 – 20 Oct", artboard 1). Dates are calendar days (`YYYY-MM-DD`), not
 * instants: ADO keeps them as midnight UTC, so formatting them as instants would shift a day
 * either side of UTC.
 */
export const SprintSchema = z.object({
  /** ADO iteration id (a GUID); `ui.lastSprint` stores it. */
  id: z.string().min(1),
  /** As named in ADO, e.g. `Sprint 42`. */
  name: z.string().min(1),
  /** Iteration path, e.g. `Onsite Companion\Sprint 42`; work item queries filter on it (AL-062). */
  path: z.string().min(1),
  /** First day, or null when the iteration has no dates in ADO. */
  start: z.iso.date().nullable(),
  /** Last day, inclusive, or null when the iteration has no dates in ADO. */
  finish: z.iso.date().nullable(),
  timeFrame: SprintTimeFrameSchema,
});
export type Sprint = z.infer<typeof SprintSchema>;

/** A team's sprints, oldest first, and which one is current. */
export const SprintListSchema = z
  .object({
    sprints: z.array(SprintSchema),
    /** From ADO's `$timeframe=current`; null between sprints or when the team has no sprints. */
    currentId: z.string().min(1).nullable(),
  })
  .refine(
    ({ sprints, currentId }) => {
      const current = sprints.filter((sprint) => sprint.timeFrame === 'current').map((sprint) => sprint.id);
      return currentId === null ? current.length === 0 : current.length === 1 && current[0] === currentId;
    },
    { message: 'Exactly the sprint named by currentId is current', path: ['currentId'] },
  );
export type SprintList = z.infer<typeof SprintListSchema>;

/**
 * The sprint to show (AL-061). `selectedId` wins while it is still one of the team's sprints, so a
 * past or future sprint the user picked survives a refetch. Otherwise the current sprint is
 * pre-selected; between sprints, the next one to start; failing that, the latest past one.
 * Null when the team has no sprints.
 */
export function pickSprint(list: SprintList, selectedId?: string | null): Sprint | null {
  const { sprints, currentId } = list;
  const find = (id: string | null | undefined) => (id ? sprints.find((sprint) => sprint.id === id) : undefined);
  return (
    find(selectedId) ??
    find(currentId) ??
    sprints.find((sprint) => sprint.timeFrame === 'future') ??
    sprints.findLast((sprint) => sprint.timeFrame === 'past') ??
    null
  );
}

// ── Channels ─────────────────────────────────────────────────────────────────

export const adoInvokeContracts = {} as const satisfies Record<(typeof ADO_INVOKE_CHANNELS)[number], InvokeContract>;

export const adoEventContracts = {} as const satisfies Record<(typeof ADO_EVENT_CHANNELS)[number], z.ZodType>;
