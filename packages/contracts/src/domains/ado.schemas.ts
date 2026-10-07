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

// ── Work items (AL-062) ──────────────────────────────────────────────────────

/**
 * ADO's state categories (`Proposed`, `InProgress`, `Resolved`, `Completed`, `Removed`), kebab-cased
 * like the rest of the vocabulary. The UI colours a work item's state by category, because state
 * names differ per process ("Active", "Committed" and "Doing" are all in progress). `unknown` when
 * ADO could not say (AL-062).
 */
export const WORK_ITEM_STATE_CATEGORIES = ['proposed', 'in-progress', 'resolved', 'completed', 'removed', 'unknown'] as const;
export const WorkItemStateCategorySchema = z.enum(WORK_ITEM_STATE_CATEGORIES);
export type WorkItemStateCategory = z.infer<typeof WorkItemStateCategorySchema>;

/** ADO work item ids are positive 32-bit integers. */
export const WORK_ITEM_ID_MAX = 2_147_483_647;
export const WorkItemIdSchema = z.int().min(1).max(WORK_ITEM_ID_MAX);
export type WorkItemId = z.infer<typeof WorkItemIdSchema>;

export const WorkItemAssigneeSchema = z.object({
  displayName: z.string(),
  /** Sign-in name (usually an email); null when ADO gave only a display name. */
  uniqueName: z.string().nullable(),
});
export type WorkItemAssignee = z.infer<typeof WorkItemAssigneeSchema>;

/**
 * One Azure DevOps work item as the app shows it (artboards 2 and 3, R6): "#71273 · Cutover
 * frmJobControl to Blazor · Story · Active", its sprint and assignee, and "Open in Azure DevOps ↗".
 * Built by `@agent-lanes/ado-client` (AL-062); AL-065 sends it over IPC.
 */
export const WorkItemSchema = z.object({
  id: WorkItemIdSchema,
  /** `System.TeamProject`; the comments and pull request APIs are project-scoped. */
  project: z.string().min(1),
  /** `System.WorkItemType` as ADO names it ("User Story", "Bug", "Task", "Product Backlog Item"). */
  type: z.string().min(1),
  title: z.string(),
  /** `System.State` as ADO names it ("Active", "New", "Closed"). */
  state: z.string(),
  stateCategory: WorkItemStateCategorySchema,
  assignedTo: WorkItemAssigneeSchema.nullable(),
  /** `System.IterationPath`, e.g. `OnSite Companion\Sprint 42`; its last segment is the sprint name. */
  iterationPath: z.string(),
  /** `System.Description` as ADO stores it (HTML); null when empty. */
  description: z.string().nullable(),
  /** `Microsoft.VSTS.Common.AcceptanceCriteria` (HTML); null when empty or the type has none. */
  acceptanceCriteria: z.string().nullable(),
  /** The item in the ADO web UI, for "Open in Azure DevOps ↗". Only http(s), so it is safe to open externally. */
  webUrl: z.url({ protocol: /^https?$/ }),
});
export type WorkItem = z.infer<typeof WorkItemSchema>;

// ── Channels ─────────────────────────────────────────────────────────────────

export const adoInvokeContracts = {} as const satisfies Record<(typeof ADO_INVOKE_CHANNELS)[number], InvokeContract>;

export const adoEventContracts = {} as const satisfies Record<(typeof ADO_EVENT_CHANNELS)[number], z.ZodType>;
