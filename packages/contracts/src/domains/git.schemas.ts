import { z } from 'zod';
import type { InvokeContract } from '../contract';
import { TicketIdSchema } from '../events';
import type { GIT_EVENT_CHANNELS, GIT_INVOKE_CHANNELS } from './git.names';
import { TicketRecordSchema } from './tickets.schemas';

// ── Workspace preview in the New agent ticket modal (AL-164, artboard 2) ───────────────────────
//
// Read-only: names the ticket's branch and worktree folder the way launch will (AL-082, AL-083),
// and checks a branch name the user edited, without creating anything. Launch re-validates.

/** What the ticket works on; null in the request until a work item is picked. */
export const WorktreePreviewSubjectSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('work-item'),
    workItemId: z.int().min(1).max(2_147_483_647),
    /** The work item title; the branch slug comes from it. */
    title: z.string(),
  }),
  z.strictObject({
    /** "No ticket": `nt-<yyyymmdd>-<slug>` from the job description. */
    kind: z.literal('no-ticket'),
    description: z.string(),
  }),
]);
export type WorktreePreviewSubject = z.infer<typeof WorktreePreviewSubjectSchema>;

export const WorktreePreviewRequestSchema = z.strictObject({
  /** A registered repo's main checkout (settings `repos[].path`). */
  repo: z.string().min(1),
  subject: WorktreePreviewSubjectSchema.nullable(),
  /** The branch name as the user edited it; null previews the generated name. */
  branch: z.string().max(1_000).nullable(),
});
export type WorktreePreviewRequest = z.infer<typeof WorktreePreviewRequestSchema>;

/** Why an edited branch name would be refused at launch (same reasons as the worktree service). */
export const WORKTREE_NAME_PROBLEMS = ['invalid-branch', 'branch-taken'] as const;
export const WorktreeNameProblemSchema = z.enum(WORKTREE_NAME_PROBLEMS);
export type WorktreeNameProblem = z.infer<typeof WorktreeNameProblemSchema>;

export const WorktreePreviewSchema = z.object({
  /** The repo's main checkout and its display name. */
  repo: z.string().min(1),
  repoName: z.string().min(1),
  /** The branch the ticket starts from (the repo's base branch setting). */
  baseBranch: z.string().min(1),
  /** The branch launch would generate; null until there is a subject. */
  generatedBranch: z.string().nullable(),
  /** The branch the ticket would use: the edited name, else the generated one. */
  branch: z.string().nullable(),
  /** `<worktree root>/<ticket id>`; null until there is a subject. */
  worktreePath: z.string().nullable(),
  /** Why launch would refuse the edited name, with one sentence for the modal; null when it is fine. */
  problem: z.object({ reason: WorktreeNameProblemSchema, message: z.string().min(1) }).nullable(),
});
export type WorktreePreview = z.infer<typeof WorktreePreviewSchema>;

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

// ── Merge worktree → main (AL-087, design §9 step 5, R9, §13) ───────────────────────────────────
//
// Merges the ticket branch into its base branch with `--no-ff` and pushes the base to origin. Error
// Results carry `details.reason`:
// - GIT_DIRTY `worktree-dirty`: the ticket worktree has uncommitted changes (`details.files`).
// - GIT_DIRTY `base-checkout-dirty`: the checkout that has the base branch checked out (usually the
//   repo's main checkout) has staged or unstaged changes (`details.files`, `details.worktreePath`).
// - MERGE_CONFLICT `conflict`: the merge would conflict (`details.files`); nothing was changed.
// - VALIDATION `ticket-not-found`, `qa-not-passed` (send `acceptQaWarning`), `worktree-missing`,
//   `branch-missing`, `base-not-found`, `base-diverged` (local base and origin's have both moved on).
// - INTERNAL `fetch-failed`, `push-failed` (the merge is kept locally; trying again only pushes),
//   `git-failed`.

/** What the confirm modal names and warns about. */
export const MergeToMainPreviewSchema = z.object({
  ticketId: TicketIdSchema,
  /** The ticket branch, e.g. `71273-cutover-job-control`. */
  source: z.string().min(1),
  /** The base branch it merges into, e.g. `main`. */
  target: z.string().min(1),
  /** The repo's main checkout. */
  repo: z.string().min(1),
  /** QA passed: the ticket went through QA and on to Create PR or Done. The modal warns when false. */
  qaPassed: z.boolean(),
  /** The ticket worktree; a dirty one cannot be merged. */
  worktree: WorktreeStateSchema,
  /** Commits on the ticket branch not on the base; null when either branch is missing. */
  ahead: CountSchema.nullable(),
  /** The ticket branch is already part of the base: merging only pushes and moves the card. */
  alreadyMerged: z.boolean(),
});
export type MergeToMainPreview = z.infer<typeof MergeToMainPreviewSchema>;

export const MergeToMainRequestSchema = z.strictObject({
  ticketId: TicketIdSchema,
  /** The user confirmed the merge in the modal. */
  confirmed: z.literal(true),
  /** The user saw the "QA has not passed" warning and merges anyway. */
  acceptQaWarning: z.boolean().optional(),
});
export type MergeToMainRequest = z.infer<typeof MergeToMainRequestSchema>;

export const MergeToMainResultSchema = z.object({
  /** The ticket record, now in Done. */
  record: TicketRecordSchema,
  /** The base branch merged into. */
  target: z.string().min(1),
  /** The merge commit; null when the ticket branch was already part of the base. */
  mergeCommit: z.string().min(1).nullable(),
  /** False when the repo has no origin remote, so there was nothing to push to. */
  pushed: z.boolean(),
  /** When the card entered Done ("Merged into main · 15:20"). */
  mergedAt: z.int().nonnegative(),
});
export type MergeToMainResult = z.infer<typeof MergeToMainResultSchema>;

// ── Diff provider (AL-089, artboard 3 Diff tab) ─────────────────────────────────────────────────

/** Most files one `git:diff` lists; `truncated` says when there were more. */
export const DIFF_MAX_FILES = 2_000;
/** Largest unified diff `git:diffFile` returns; a bigger one is a `too-large` placeholder. */
export const DIFF_FILE_MAX_BYTES = 256 * 1024;

/**
 * What a ticket's diff is taken against: its base branch (everything the ticket changed), or one
 * sub-branch against the ticket branch (what that sub-agent changed).
 */
export const DiffAgainstSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('base') }),
  z.strictObject({ kind: z.literal('sub-branch'), branch: z.string().min(1).max(255) }),
]);
export type DiffAgainst = z.infer<typeof DiffAgainstSchema>;

export const DIFF_FILE_STATUSES = ['added', 'modified', 'deleted', 'renamed', 'copied', 'type-changed', 'unmerged', 'untracked'] as const;
export const DiffFileStatusSchema = z.enum(DIFF_FILE_STATUSES);
export type DiffFileStatus = z.infer<typeof DiffFileStatusSchema>;

export const DiffFileSchema = z.object({
  /** Path relative to the worktree, with `/` separators. */
  path: z.string().min(1),
  /** The path before a rename or copy; null otherwise. */
  oldPath: z.string().min(1).nullable(),
  status: DiffFileStatusSchema,
  /** Lines added and removed; null for a binary file. */
  additions: CountSchema.nullable(),
  deletions: CountSchema.nullable(),
  binary: z.boolean(),
});
export type DiffFile = z.infer<typeof DiffFileSchema>;

export const GitDiffRequestSchema = z.strictObject({ ticketId: TicketIdSchema, against: DiffAgainstSchema });
export type GitDiffRequest = z.infer<typeof GitDiffRequestSchema>;

export const GitDiffSchema = z.object({
  ticketId: TicketIdSchema,
  against: DiffAgainstSchema,
  /** The branch compared with (`main`, `origin/main` or the ticket branch) and the merge base the diff starts at. */
  fromRef: z.string().min(1),
  fromCommit: z.string().min(1),
  /** The branch whose changes are shown. */
  toRef: z.string().min(1),
  /** True when the branch's worktree exists, so uncommitted and untracked files are included. */
  includesUncommitted: z.boolean(),
  files: z.array(DiffFileSchema).max(DIFF_MAX_FILES),
  /** More files changed than `files` lists. */
  truncated: z.boolean(),
  totals: z.object({ files: CountSchema, additions: CountSchema, deletions: CountSchema }),
});
export type GitDiff = z.infer<typeof GitDiffSchema>;

export const GitDiffFileRequestSchema = z.strictObject({
  ticketId: TicketIdSchema,
  against: DiffAgainstSchema,
  /** A path from `git:diff` (relative, `/` separators). */
  path: z.string().min(1).max(4096),
  /** The old path of a rename or copy. */
  oldPath: z.string().min(1).max(4096).optional(),
});
export type GitDiffFileRequest = z.infer<typeof GitDiffFileRequestSchema>;

/** One file's diff, or the placeholder shown instead of raw content. */
export const GitDiffFileSchema = z.discriminatedUnion('kind', [
  /** Git's unified diff, at most DIFF_FILE_MAX_BYTES. */
  z.object({ kind: z.literal('text'), path: z.string().min(1), patch: z.string() }),
  /** "Binary file not shown". */
  z.object({ kind: z.literal('binary'), path: z.string().min(1) }),
  /** "Diff too large to show"; `bytes` is the file or diff size when known. */
  z.object({ kind: z.literal('too-large'), path: z.string().min(1), bytes: CountSchema.nullable(), limit: CountSchema }),
]);
export type GitDiffFile = z.infer<typeof GitDiffFileSchema>;

// ── Merge sub-branches → ticket branch (AL-086, design §9 step 4, R9) ───────────────────────────
//
// Merges every ready sub-branch (clean, its sub-agent finished, commits ahead) into the ticket branch
// in creation order, each with `--no-ff`, in the ticket worktree. Stops at the first conflict and
// leaves that merge in progress there, so the lead agent or the user can resolve it; nothing after
// the conflicting branch is merged. Error Results carry `details.reason`:
// - MERGE_CONFLICT `conflict`: `details.branch`, `details.files`, `details.merged` (branches merged before it).
// - MERGE_CONFLICT `merge-in-progress`: an earlier conflict is not resolved yet (`details.files`).
// - GIT_DIRTY `worktree-dirty`: the ticket worktree has uncommitted changes (`details.files`).
// - VALIDATION `ticket-not-found`, `worktree-missing`, `no-conflict`; INTERNAL `git-failed`.

/** One sub-branch merged into the ticket branch. */
export const MergedSubBranchSchema = z.object({
  name: z.string().min(1),
  branch: z.string().min(1),
  /** The merge commit on the ticket branch. */
  commit: z.string().min(1),
});
export type MergedSubBranch = z.infer<typeof MergedSubBranchSchema>;

/** A sub-branch left out: not ready (dirty, missing, or its sub-agent still runs), or nothing new on it. */
export const SkippedSubBranchSchema = z.object({
  name: z.string().min(1),
  branch: z.string().min(1),
  reason: z.enum(['not-ready', 'nothing-to-merge']),
});
export type SkippedSubBranch = z.infer<typeof SkippedSubBranchSchema>;

export const MergeSubBranchesResultSchema = z.object({
  ticketId: TicketIdSchema,
  /** The ticket branch merged into. */
  target: z.string().min(1),
  /** In the order they were merged (creation order). */
  merged: z.array(MergedSubBranchSchema),
  skipped: z.array(SkippedSubBranchSchema),
});
export type MergeSubBranchesResult = z.infer<typeof MergeSubBranchesResultSchema>;

/** "Hand to lead agent": the conflicted files were sent to the lead agent as a user turn (`held` while it is paused). */
export const HandConflictResultSchema = z.object({
  files: z.array(z.string().min(1)),
  held: z.boolean(),
});
export type HandConflictResult = z.infer<typeof HandConflictResultSchema>;

/** Most files "I'll resolve it" opens at once. */
export const OPEN_CONFLICT_FILES_LIMIT = 20;

/** "I'll resolve it": the conflicted files opened in the user's editor (absolute paths). */
export const OpenConflictFilesResultSchema = z.object({
  opened: z.array(z.string().min(1)).max(OPEN_CONFLICT_FILES_LIMIT),
  /** How many files conflict; at most OPEN_CONFLICT_FILES_LIMIT are opened. */
  fileCount: CountSchema,
});
export type OpenConflictFilesResult = z.infer<typeof OpenConflictFilesResultSchema>;

export const gitInvokeContracts = {
  /** `VALIDATION` with `details.reason: 'ticket-not-found'` for an unknown ticket. */
  'branches:status': { request: TicketRefRequestSchema, response: BranchStatusSchema },
  'git:mergeToMainPreview': { request: TicketRefRequestSchema, response: MergeToMainPreviewSchema },
  'git:mergeToMain': { request: MergeToMainRequestSchema, response: MergeToMainResultSchema },
  /** VALIDATION `ticket-not-found`, `sub-branch-not-found`, `base-not-found` or `branch-missing`. */
  'git:diff': { request: GitDiffRequestSchema, response: GitDiffSchema },
  /** VALIDATION `invalid-path` for an absolute path or one that leaves the worktree. */
  'git:diffFile': { request: GitDiffFileRequestSchema, response: GitDiffFileSchema },
  'git:mergeSubBranches': { request: TicketRefRequestSchema, response: MergeSubBranchesResultSchema },
  /** "Hand to lead agent": a user turn listing the conflicted files. */
  'git:handConflictToLead': { request: TicketRefRequestSchema, response: HandConflictResultSchema },
  /** "I'll resolve it": opens the conflicted files in the user's editor. */
  'git:openConflictFiles': { request: TicketRefRequestSchema, response: OpenConflictFilesResultSchema },
  /** Previews the ticket's branch and worktree and validates an edited branch name (AL-164). VALIDATION for an unregistered repo. */
  'git:previewWorktree': { request: WorktreePreviewRequestSchema, response: WorktreePreviewSchema },
} as const satisfies Record<(typeof GIT_INVOKE_CHANNELS)[number], InvokeContract>;

export const gitEventContracts = {} as const satisfies Record<(typeof GIT_EVENT_CHANNELS)[number], z.ZodType>;
