import { z } from 'zod';
import type { InvokeContract } from '../contract';
import { ConnectionIdSchema } from './connections.schemas';
import { WorkItemIdSchema } from './ado.ids';
import type { ADO_EVENT_CHANNELS, ADO_INVOKE_CHANNELS } from './ado.names';
import {
  CreatedPullRequestSchema,
  CreatePullRequestInputSchema,
  PullRequestRefSchema,
  PullRequestSnapshotSchema,
} from './ado.pull-requests';
import { WorkItemCommentSchema } from './ado.write-back';
import { TeamBoardSchema, TeamListSchema } from './ado.team-board';
import { ActivePullRequestListSchema } from './ado.active-prs';
import { BACKLOG_PAGE_SIZE_MAX, BacklogKindSchema, BacklogPageSchema } from './ado.backlog';

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

// Defined in a leaf file so the PR and write-back DTOs can use it without an import cycle (AL-065).
export { WORK_ITEM_ID_MAX, WorkItemIdSchema, type WorkItemId } from './ado.ids';

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

// ── Channel requests (AL-065) ────────────────────────────────────────────────

/**
 * The Azure DevOps organisation a request goes to: its connection id (`ado:contoso`, AL-042). Left
 * out, the main process uses the first connected organisation, as `connections:list` orders them.
 * Tokens never travel with a request; main picks the organisation's client from its saved connection.
 */
export const AdoOrgIdSchema = ConnectionIdSchema.refine((id) => id.startsWith('ado:'), 'Not an Azure DevOps connection id');

/** Text that goes into a path or a WIQL literal: trimmed, bounded, no control characters. */
const adoText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}]*$/u, 'No control characters');

/** Project name or id. Left out, the organisation's default project from Connections. */
export const AdoProjectNameSchema = adoText(256);

/** Most characters a work item search may have (the ado-client's `SEARCH_QUERY_MAX_LENGTH`). */
export const WORK_ITEM_SEARCH_MAX_LENGTH = 256;
/** Most items one search returns (the ado-client's `SEARCH_TOP_MAX`). */
export const WORK_ITEM_SEARCH_TOP_MAX = 200;

/** Which organisation and project a request reads; both default as described above. */
const AdoScopeShape = {
  org: AdoOrgIdSchema.optional(),
  project: AdoProjectNameSchema.optional(),
};

/** `ado:listSprints`: a team's sprints, past, current and future. */
export const ListSprintsRequestSchema = z.strictObject({
  ...AdoScopeShape,
  /** Team name or id. Left out, ADO uses the project's default team. */
  team: adoText(256).optional(),
});
export type ListSprintsRequest = z.infer<typeof ListSprintsRequestSchema>;

/** `ado:listWorkItems`: the stories, bugs and tasks in one sprint, lowest id first. */
export const ListWorkItemsRequestSchema = z.strictObject({
  ...AdoScopeShape,
  /** The sprint's `path` (`OnSite Companion\Sprint 42`), from `ado:listSprints`. */
  iterationPath: adoText(1_024),
});
export type ListWorkItemsRequest = z.infer<typeof ListWorkItemsRequestSchema>;

/** `ado:searchWorkItems`: by id ("71273", "#71273") or part of a title; a blank query finds nothing. */
export const SearchWorkItemsRequestSchema = z.strictObject({
  ...AdoScopeShape,
  query: z
    .string()
    .trim()
    .max(WORK_ITEM_SEARCH_MAX_LENGTH)
    .regex(/^[^\p{Cc}]*$/u, 'No control characters'),
  /** Most items returned: the exact id match first, then title matches. Default 50. */
  top: z.int().min(1).max(WORK_ITEM_SEARCH_TOP_MAX).optional(),
});
export type SearchWorkItemsRequest = z.infer<typeof SearchWorkItemsRequestSchema>;

/** `ado:getWorkItem`: one work item by id, in any project of the organisation. */
export const GetWorkItemRequestSchema = z.strictObject({
  org: AdoOrgIdSchema.optional(),
  id: WorkItemIdSchema,
});
export type GetWorkItemRequest = z.infer<typeof GetWorkItemRequestSchema>;

/** `ado:getComments`: a work item's discussion, oldest first. `project` is the work item's (`WorkItem.project`). */
export const GetCommentsRequestSchema = z.strictObject({
  ...AdoScopeShape,
  workItemId: WorkItemIdSchema,
});
export type GetCommentsRequest = z.infer<typeof GetCommentsRequestSchema>;

/** `ado:createPullRequest`: the Create PR stage's pull request (AL-064), in an organisation. */
export const CreatePullRequestRequestSchema = CreatePullRequestInputSchema.safeExtend({ org: AdoOrgIdSchema.optional() });
export type CreatePullRequestRequest = z.infer<typeof CreatePullRequestRequestSchema>;

/** `ado:getPullRequest`: a pull request and its checks, by the ref the ticket keeps (`pullRequestRef`). */
export const GetPullRequestRequestSchema = PullRequestRefSchema.extend({ org: AdoOrgIdSchema.optional() }).strict();
export type GetPullRequestRequest = z.infer<typeof GetPullRequestRequestSchema>;

/** `ado:listTeams`: the user's teams in a project, for the team board's dropdown (AL-231). */
export const ListTeamsRequestSchema = z.strictObject({ ...AdoScopeShape });
export type ListTeamsRequest = z.infer<typeof ListTeamsRequestSchema>;

/** `ado:teamBoard`: a team's ADO board for one sprint (AL-231, T1). */
export const TeamBoardRequestSchema = z.strictObject({
  ...AdoScopeShape,
  /** Team name or id. Left out, the team from the user's ADO profile (`ado:listTeams`' default). */
  team: adoText(256).optional(),
  /** The sprint's `path` or `id` from `ado:listSprints`. Left out, the team's current sprint (`pickSprint`). */
  sprint: adoText(1_024).optional(),
});
export type TeamBoardRequest = z.infer<typeof TeamBoardRequestSchema>;

/** `ado:activePrs`: open pull requests for a team's repositories, with unresolved thread counts (AL-232). */
export const ActivePrsRequestSchema = z.strictObject({
  ...AdoScopeShape,
  /** Team name or id. Left out, the team from the user's ADO profile. */
  team: adoText(256).optional(),
});
export type ActivePrsRequest = z.infer<typeof ActivePrsRequestSchema>;

/** The Backlog popout's filters (AL-233, TB§5). Every filter given must match (AND). */
export const BacklogFiltersSchema = z.strictObject({
  /** Story / Bug / Task; left out or empty, all three. */
  kinds: z.array(BacklogKindSchema).max(3).optional(),
  /** Priorities 1–4; any of them. */
  priorities: z.array(z.int().min(1).max(4)).max(4).optional(),
  /** Area paths; items under any of them. */
  areas: z.array(adoText(1_024)).max(20).optional(),
  /** Tags; items with every one of them. */
  tags: z.array(adoText(256)).max(20).optional(),
  /** Free text: an id ("71360", "#71360"), or part of a title or tag. Blank means no text filter. */
  text: z
    .string()
    .trim()
    .max(256)
    .regex(/^[^\p{Cc}]*$/u, 'No control characters')
    .optional(),
  /** Also show items already in a sprint. Default false. */
  includeInSprint: z.boolean().optional(),
});
export type BacklogFilters = z.infer<typeof BacklogFiltersSchema>;

/** `ado:backlog`: one page of the team's backlog (AL-233). */
export const BacklogRequestSchema = z.strictObject({
  ...AdoScopeShape,
  /** Team name or id. Left out, the team from the user's ADO profile. */
  team: adoText(256).optional(),
  filters: BacklogFiltersSchema.optional(),
  /** Zero-based page and its size. Default the first page of 50 (`BACKLOG_PAGE_SIZE`). */
  page: z
    .strictObject({
      index: z.int().min(0).max(10_000),
      size: z.int().min(1).max(BACKLOG_PAGE_SIZE_MAX),
    })
    .optional(),
});
export type BacklogRequest = z.infer<typeof BacklogRequestSchema>;

// ── Channels ─────────────────────────────────────────────────────────────────

export const adoInvokeContracts = {
  /** Past, current and future sprints, oldest first; `pickSprint` chooses the one to show. */
  'ado:listSprints': { request: ListSprintsRequestSchema, response: SprintListSchema },
  'ado:listWorkItems': { request: ListWorkItemsRequestSchema, response: z.array(WorkItemSchema) },
  'ado:searchWorkItems': { request: SearchWorkItemsRequestSchema, response: z.array(WorkItemSchema) },
  'ado:getWorkItem': { request: GetWorkItemRequestSchema, response: WorkItemSchema },
  'ado:getComments': { request: GetCommentsRequestSchema, response: z.array(WorkItemCommentSchema) },
  /** Idempotent: an active pull request for the same branches is reused (`created: false`). */
  'ado:createPullRequest': { request: CreatePullRequestRequestSchema, response: CreatedPullRequestSchema },
  /** The pull request with its checks, for "PR !10612 · 3 / 4 checks" and Done detection. */
  'ado:getPullRequest': { request: GetPullRequestRequestSchema, response: PullRequestSnapshotSchema },
  /** The user's teams and the default one (AL-231). */
  'ado:listTeams': { request: ListTeamsRequestSchema, response: TeamListSchema },
  /** A team's board columns and the sprint's items on it (AL-231). */
  'ado:teamBoard': { request: TeamBoardRequestSchema, response: TeamBoardSchema },
  /** The team's open pull requests with unresolved thread counts (AL-232). */
  'ado:activePrs': { request: ActivePrsRequestSchema, response: ActivePullRequestListSchema },
  /** One page of the team's backlog, grouped by Feature, filters applied in WIQL (AL-233). */
  'ado:backlog': { request: BacklogRequestSchema, response: BacklogPageSchema },
} as const satisfies Record<(typeof ADO_INVOKE_CHANNELS)[number], InvokeContract>;

export const adoEventContracts = {} as const satisfies Record<(typeof ADO_EVENT_CHANNELS)[number], z.ZodType>;
