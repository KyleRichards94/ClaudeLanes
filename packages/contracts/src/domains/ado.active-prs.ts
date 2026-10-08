import { z } from 'zod';
import { PullRequestIdSchema, PullRequestRepositorySchema } from './ado.pull-requests';
import { TeamBoardPersonSchema, TeamRefSchema } from './ado.team-board';

/**
 * The team board's Active PRs column (AL-232, T1, T3, T4): open pull requests for the team's
 * repositories with their unresolved comment threads, so a PR card shows "4 comments" and the drop
 * rules know whether Implementing can answer them. `ado.schemas.ts` declares `ado:activePrs`.
 */

/** A reviewer and their vote (10 approved, 5 approved with suggestions, 0 none, -5 waiting, -10 rejected). */
export const ActivePullRequestReviewerSchema = TeamBoardPersonSchema.extend({
  vote: z.int().min(-10).max(10),
  isRequired: z.boolean(),
  /** A group or team rather than a person. */
  isContainer: z.boolean(),
});
export type ActivePullRequestReviewer = z.infer<typeof ActivePullRequestReviewerSchema>;

/** One card in the Active PRs column (artboard 08: "!10598 · PR · Supplier invoice matching rules · 4 comments"). */
export const ActivePullRequestSchema = z.object({
  id: PullRequestIdSchema,
  title: z.string(),
  isDraft: z.boolean(),
  author: TeamBoardPersonSchema,
  reviewers: z.array(ActivePullRequestReviewerSchema),
  /** Without `refs/heads/`. */
  sourceBranch: z.string().min(1),
  targetBranch: z.string().min(1),
  repository: PullRequestRepositorySchema,
  createdAt: z.iso.datetime(),
  /** Active comment threads: resolved, closed, deleted and system threads are not counted. */
  unresolvedThreads: z.int().nonnegative(),
  /**
   * Whether the PR's repository is registered in Agent Lanes. False: a drop is refused with "Add repo"
   * (TB§7) instead of starting an agent with nowhere to make its worktree.
   */
  repoRegistered: z.boolean(),
  webUrl: z.url({ protocol: /^https?$/ }),
});
export type ActivePullRequest = z.infer<typeof ActivePullRequestSchema>;

/** `ado:activePrs`: the team's open pull requests, newest first. */
export const ActivePullRequestListSchema = z.object({
  team: TeamRefSchema,
  pullRequests: z.array(ActivePullRequestSchema),
});
export type ActivePullRequestList = z.infer<typeof ActivePullRequestListSchema>;
