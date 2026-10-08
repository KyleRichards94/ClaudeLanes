import { z } from 'zod';
import { TicketIdSchema } from '../events';
import { EffortSchema, LaneSchema, ModelSchema } from '../vocabulary';
import { WorkItemIdSchema } from './ado.ids';
import { PullRequestIdSchema } from './ado.pull-requests';
import { AgentSessionStatusSchema } from './agent.status';
import { ConnectionIdSchema } from './connections.schemas';
import { StageGatesSchema } from './settings.schemas';
import { TicketRecordSchema } from './tickets.schemas';

/**
 * Launch from the team board (AL-236, T3–T5, T9, TB§4): a card dropped on an agent lane starts the
 * agent for that lane as one main-process transaction. Main reads the card again from Azure DevOps and
 * re-runs the drop rules (AL-230) before anything changes; only a To Do, Failed or backlog item dropped
 * on Planning or Implementing is assigned to the user and moved to In Progress. Then the worktree, the
 * ticket and the session (or Queued). A failing step rolls back the earlier ones. The answer carries an
 * undo id for the success toast (AL-237): an opaque handle, not a credential.
 */

/** Longest team or sprint name or path a source carries. */
const NameSchema = z.string().trim().min(1).max(1024);

/** What was dropped, as the board showed it; main reads it again before acting. */
export const LaunchSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('board-item'),
    id: WorkItemIdSchema,
    /** The team board's team (id or name) and sprint (iteration path or id): main reads that board again. */
    team: NameSchema,
    sprint: NameSchema,
    /** The column the board showed the card in, so a refusal can say where it moved ("Moved to Testing — refreshed"). */
    column: z.string().max(256).optional(),
  }),
  z.strictObject({ kind: z.literal('backlog-item'), id: WorkItemIdSchema }),
  z.strictObject({
    kind: z.literal('pull-request'),
    id: PullRequestIdSchema,
    /** The team whose repositories the Active PRs column lists; the profile team when left out. */
    team: NameSchema.optional(),
  }),
]);
export type LaunchSource = z.infer<typeof LaunchSourceSchema>;

/** One drop's skills, model, effort and gates, from the Alt launch sheet (AL-240); the lane's defaults otherwise. */
export const LaunchOverridesSchema = z.strictObject({
  /** Skill names without the leading slash. */
  skills: z.array(z.string().min(1).max(200)).max(64).optional(),
  model: ModelSchema.optional(),
  effort: EffortSchema.optional(),
  gates: StageGatesSchema.optional(),
});
export type LaunchOverrides = z.infer<typeof LaunchOverridesSchema>;

/** `agent:launchFromAdo`. */
export const LaunchFromAdoRequestSchema = z.strictObject({
  /** The organisation (`ado:contoso`); the first connected one when left out. */
  org: ConnectionIdSchema.refine((id) => id.startsWith('ado:'), 'Not an Azure DevOps connection id').optional(),
  /** The project; the connection's default project when left out. */
  project: z.string().trim().min(1).max(256).optional(),
  source: LaunchSourceSchema,
  lane: LaneSchema,
  /** The board's repo (settings `repos[].path`) for a work item; a pull request uses the repo its repository is registered as. */
  repo: z.string().min(1).max(4096).optional(),
  overrides: LaunchOverridesSchema.optional(),
});
export type LaunchFromAdoRequest = z.infer<typeof LaunchFromAdoRequestSchema>;

/** The Azure DevOps change a drop made: only ever assign to you and move to In Progress (T5). */
export const LaunchAdoChangeSchema = z.object({
  workItemId: WorkItemIdSchema,
  /** Who it was assigned to before, by display name; null when unassigned. */
  previousAssignee: z.string().nullable(),
  previousState: z.string(),
  /** The state it was moved to ("Active"). */
  state: z.string(),
});
export type LaunchAdoChange = z.infer<typeof LaunchAdoChangeSchema>;

/** How long Undo is offered after a launch (T8): 10 s, or until the agent's first turn ends. */
export const LAUNCH_UNDO_WINDOW_MS = 10_000;

export const LaunchFromAdoResponseSchema = z.object({
  ticketId: TicketIdSchema,
  /** The new ticket: in the dropped lane once its session started, else in Queued. */
  record: TicketRecordSchema,
  status: AgentSessionStatusSchema,
  /** What changed in Azure DevOps; null for every drop but a To Do or Failed item on Planning or Implementing. */
  adoChange: LaunchAdoChangeSchema.nullable(),
  /** For `agent:undoLaunch` (AL-237); valid for LAUNCH_UNDO_WINDOW_MS or until the first turn ends. */
  undoId: z.string().min(16).max(128),
  /** The success toast: "#71318 assigned to you and moved to In Progress · agent started in Planning". */
  summary: z.string().max(500),
});
export type LaunchFromAdoResponse = z.infer<typeof LaunchFromAdoResponseSchema>;

/**
 * Why a launch was refused, in `details.reason` of its VALIDATION error:
 * - `refused`: the drop rules refuse the card now (it moved, was taken, has an agent); `message` says why;
 * - `moved`: it moved column since the board loaded ("Moved to Testing — refreshed");
 * - `not-found`: it is no longer on the board, in the backlog, or open;
 * - `add-repo`: the PR's repository isn't registered (TB§7): the toast offers "Add repo";
 * - `no-repo`: no repo to make the worktree in.
 * A missing token scope is ADO_SCOPE_MISSING with `details.scope` and `details.org` ("Open Connections").
 */
export const LAUNCH_REFUSALS = ['refused', 'moved', 'not-found', 'add-repo', 'no-repo'] as const;
export type LaunchRefusal = (typeof LAUNCH_REFUSALS)[number];
