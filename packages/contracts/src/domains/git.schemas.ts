import { z } from 'zod';
import type { InvokeContract } from '../contract';
import type { GIT_EVENT_CHANNELS, GIT_INVOKE_CHANNELS } from './git.names';

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

export const gitInvokeContracts = {
  /** Previews the ticket's branch and worktree and validates an edited branch name (AL-164). VALIDATION for an unregistered repo. */
  'git:previewWorktree': { request: WorktreePreviewRequestSchema, response: WorktreePreviewSchema },
} as const satisfies Record<(typeof GIT_INVOKE_CHANNELS)[number], InvokeContract>;

export const gitEventContracts = {} as const satisfies Record<(typeof GIT_EVENT_CHANNELS)[number], z.ZodType>;
