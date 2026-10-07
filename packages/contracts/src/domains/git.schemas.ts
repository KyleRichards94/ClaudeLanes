import { z } from 'zod';
import type { InvokeContract } from '../contract';
import { TicketIdSchema } from '../events';
import type { GIT_EVENT_CHANNELS, GIT_INVOKE_CHANNELS } from './git.names';

// ── Branch status (AL-085, artboard 3 Sub-branches "4 ahead · Ready") ───────────────────────────

const CountSchema = z.int().nonnegative();

/** A ticket to look up by id (`71273` or `nt-20261007-fix-the-login`). */
export const TicketRefRequestSchema = z.strictObject({ ticketId: TicketIdSchema });
export type TicketRefRequest = z.infer<typeof TicketRefRequestSchema>;

/**
 * A worktree's own state. `missing`: its folder is gone (deleted outside the app), so it has no
 * working-tree state and is never ready.
 */
export const WorktreeStateSchema = z.object({
  worktreePath: z.string().min(1),
  present: z.boolean(),
  /** Uncommitted changes: staged, unstaged, unmerged or untracked files (ignored files don't count). Null when missing. */
  dirty: z.boolean().nullable(),
  /** How many paths `git status` lists. Null when missing. */
  changedFiles: CountSchema.nullable(),
  /** A merge stopped on conflicts in this worktree. */
  conflicted: z.boolean(),
});
export type WorktreeState = z.infer<typeof WorktreeStateSchema>;

/** The ticket branch against its base branch. */
export const TicketBranchStatusSchema = WorktreeStateSchema.extend({
  branch: z.string().min(1),
  /** The base branch name, e.g. `main`. */
  baseBranch: z.string().min(1),
  /** What it was compared with: the local base branch, else `origin/<base>`; null when neither exists. */
  baseRef: z.string().min(1).nullable(),
  /** Commits on the ticket branch not on the base, and the reverse. Null when either branch is missing. */
  ahead: CountSchema.nullable(),
  behind: CountSchema.nullable(),
});
export type TicketBranchStatus = z.infer<typeof TicketBranchStatusSchema>;

/** One writer sub-agent's branch against the ticket branch. */
export const SubBranchStatusSchema = WorktreeStateSchema.extend({
  /** The sub-agent's name (`razor-writer`). */
  name: z.string().min(1),
  /** `sub/71273-grid`. */
  branch: z.string().min(1),
  ahead: CountSchema.nullable(),
  behind: CountSchema.nullable(),
  /** The sub-agent is not running any more. */
  finished: z.boolean(),
  /** Clean and its sub-agent finished: the branch can be merged into the ticket branch (AL-086). */
  ready: z.boolean(),
  /** When Merge sub-branches merged it (AL-086); null until then. */
  mergedAt: z.int().nonnegative().nullable(),
});
export type SubBranchStatus = z.infer<typeof SubBranchStatusSchema>;

export const BranchStatusSchema = z.object({
  ticketId: TicketIdSchema,
  ticket: TicketBranchStatusSchema,
  /** In creation order, the order Merge sub-branches merges them in. */
  subBranches: z.array(SubBranchStatusSchema),
  /** When the status was read (epoch ms). */
  checkedAt: z.int().nonnegative(),
});
export type BranchStatus = z.infer<typeof BranchStatusSchema>;

export const gitInvokeContracts = {
  /** `VALIDATION` with `details.reason: 'ticket-not-found'` for an unknown ticket. */
  'branches:status': { request: TicketRefRequestSchema, response: BranchStatusSchema },
} as const satisfies Record<(typeof GIT_INVOKE_CHANNELS)[number], InvokeContract>;

export const gitEventContracts = {} as const satisfies Record<(typeof GIT_EVENT_CHANNELS)[number], z.ZodType>;
