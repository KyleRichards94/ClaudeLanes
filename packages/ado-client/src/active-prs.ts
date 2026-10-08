import { initialsOf, ok, type ActivePullRequest, type ActivePullRequestList, type ActivePullRequestReviewer, type PullRequestRepository, type Result, type TeamBoardPerson } from '@agent-lanes/contracts';
import { z } from 'zod';
import type { AdoClient } from './client';
import { DEFAULT_MAX_PAGES } from './constants';
import { adoErr } from './errors';
import { adoPath } from './path';
import { callOptions, guarded, isName, missing, resolveTeam, type TeamCallOptions } from './team-board';

/**
 * The team board's Active PRs column (AL-232, T1, T3, T4): the project's open pull requests that
 * belong to the team (author or a reviewer is on the team, or the team itself reviews), each with its
 * unresolved comment threads counted. Never throws.
 */

export interface ActivePullRequestsOptions extends TeamCallOptions {
  project: string;
  /** Team name or id. Omitted, the user's default team. */
  team?: string;
  /** Whether a PR's repository is registered in Agent Lanes; unregistered ones are flagged (TB§7 "Add repo"). Default: none are. */
  isRegistered?: (repository: PullRequestRepository) => boolean;
}

/** Pull requests per page (`$top`/`$skip`). */
export const ACTIVE_PRS_PAGE_SIZE = 100;
/** Team members per page. */
export const TEAM_MEMBERS_PAGE_SIZE = 100;
/** Thread reads in flight at once. */
export const THREAD_READS_IN_PARALLEL = 6;

const identitySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().nullish(),
  uniqueName: z.string().nullish(),
  isContainer: z.boolean().nullish(),
});

const reviewerSchema = identitySchema.extend({
  vote: z.number().int().nullish(),
  isRequired: z.boolean().nullish(),
});

const pullRequestSchema = z.object({
  pullRequestId: z.int().min(1),
  title: z.string().nullish(),
  isDraft: z.boolean().nullish(),
  status: z.string(),
  sourceRefName: z.string().min(1),
  targetRefName: z.string().min(1),
  creationDate: z.string(),
  createdBy: identitySchema,
  reviewers: z.array(reviewerSchema).nullish(),
  repository: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    project: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  }),
});
type GitPullRequest = z.infer<typeof pullRequestSchema>;
const pullRequestPageSchema = z.object({ value: z.array(pullRequestSchema) });

const membersPageSchema = z.object({ value: z.array(z.object({ identity: identitySchema })) });

const threadSchema = z.object({
  id: z.number(),
  /** `active`, `pending`, `fixed`, `wontFix`, `closed`, `byDesign`, `unknown`; system threads usually have none. */
  status: z.string().nullish(),
  isDeleted: z.boolean().nullish(),
  comments: z
    .array(z.object({ commentType: z.string().nullish(), isDeleted: z.boolean().nullish() }))
    .nullish(),
});
export type PullRequestThread = z.infer<typeof threadSchema>;
const threadsSchema = z.object({ value: z.array(threadSchema) });

/**
 * Whether a thread still needs an answer: its status is `active`, it isn't deleted, and someone wrote
 * in it (a thread whose comments are all system comments, such as a vote or a push, doesn't count).
 */
export function isUnresolvedThread(thread: PullRequestThread): boolean {
  if (thread.isDeleted || thread.status?.toLowerCase() !== 'active') return false;
  return (thread.comments ?? []).some((comment) => !comment.isDeleted && comment.commentType?.toLowerCase() !== 'system');
}

/** The team's open pull requests, newest first, with unresolved thread counts. */
export function listActivePullRequests(client: AdoClient, options: ActivePullRequestsOptions): Promise<Result<ActivePullRequestList>> {
  return guarded('list the active pull requests', async () => {
    const { project } = options;
    if (!isName(project)) return missing('project', 'list its active pull requests');
    const call = callOptions(options);

    const team = await resolveTeam(client, project, options.team, call);
    if (!team.ok) return team;
    const [members, pullRequests] = await Promise.all([
      pages(client, adoPath`/_apis/projects/${project.trim()}/teams/${team.data.id}/members`, membersPageSchema, TEAM_MEMBERS_PAGE_SIZE, {}, call),
      pages(client, adoPath`/${project.trim()}/_apis/git/pullrequests`, pullRequestPageSchema, ACTIVE_PRS_PAGE_SIZE, { 'searchCriteria.status': 'active' }, call),
    ]);
    if (!members.ok) return members;
    if (!pullRequests.ok) return pullRequests;

    const teamIds = new Set([team.data.id, ...members.data.map((member) => member.identity.id)].map((id) => id.toLowerCase()));
    const onTeam = (id: string) => teamIds.has(id.toLowerCase());
    const mine = pullRequests.data.filter(
      (pr) => pr.status.toLowerCase() === 'active' && (onTeam(pr.createdBy.id) || (pr.reviewers ?? []).some((reviewer) => onTeam(reviewer.id))),
    );

    const counts = await mapLimited(mine, THREAD_READS_IN_PARALLEL, async (pr) => {
      const threads = await client.get(adoPath`/${pr.repository.project.id}/_apis/git/repositories/${pr.repository.id}/pullRequests/${pr.pullRequestId}/threads`, threadsSchema, call);
      return threads.ok ? ok(threads.data.value.filter(isUnresolvedThread).length) : threads;
    });
    const failed = counts.find((count) => !count.ok);
    if (failed && !failed.ok) return failed;

    const isRegistered = options.isRegistered ?? (() => false);
    const list = mine
      .map((pr, index) => {
        const count = counts[index]!;
        return toActivePullRequest(client, pr, count.ok ? count.data : 0, isRegistered);
      })
      .toSorted((a, b) => b.id - a.id);
    return ok({ team: team.data, pullRequests: list });
  });
}

function toActivePullRequest(client: AdoClient, pr: GitPullRequest, unresolvedThreads: number, isRegistered: (repository: PullRequestRepository) => boolean): ActivePullRequest {
  const repository: PullRequestRepository = { id: pr.repository.id, name: pr.repository.name, projectId: pr.repository.project.id, projectName: pr.repository.project.name };
  return {
    id: pr.pullRequestId,
    title: pr.title ?? '',
    isDraft: pr.isDraft ?? false,
    author: person(pr.createdBy),
    reviewers: (pr.reviewers ?? []).map(
      (reviewer): ActivePullRequestReviewer => ({
        ...person(reviewer),
        vote: Math.max(-10, Math.min(10, reviewer.vote ?? 0)),
        isRequired: reviewer.isRequired ?? false,
        isContainer: reviewer.isContainer ?? false,
      }),
    ),
    sourceBranch: fromRef(pr.sourceRefName),
    targetBranch: fromRef(pr.targetRefName),
    repository,
    createdAt: new Date(pr.creationDate).toISOString(),
    unresolvedThreads,
    repoRegistered: isRegistered(repository),
    webUrl: `${client.orgUrl}${adoPath`/${repository.projectName}/_git/${repository.name}/pullrequest/${pr.pullRequestId}`}`,
  };
}

function person(identity: z.infer<typeof identitySchema>): TeamBoardPerson {
  const displayName = identity.displayName?.trim() || identity.uniqueName || 'Unknown';
  return { id: identity.id, displayName, uniqueName: identity.uniqueName ?? null, initials: initialsOf(displayName) };
}

function fromRef(ref: string): string {
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
}

/** Every item of a `$top`/`$skip` list. */
async function pages<T>(
  client: AdoClient,
  path: string,
  schema: z.ZodType<{ value: T[] }>,
  size: number,
  query: Record<string, string>,
  call: TeamCallOptions,
): Promise<Result<T[]>> {
  const items: T[] = [];
  for (let page = 0; page < DEFAULT_MAX_PAGES; page += 1) {
    const received = await client.get(path, schema, { ...call, query: { ...query, $top: size, $skip: page * size } });
    if (!received.ok) return received;
    items.push(...received.data.value);
    if (received.data.value.length < size) return ok(items);
  }
  return adoErr('INTERNAL', `Listing ${path} needed more than ${DEFAULT_MAX_PAGES} pages; stopped.`, { kind: 'paging', method: 'GET', attempts: DEFAULT_MAX_PAGES });
}

/** `fn` over `items`, at most `limit` at a time, results in order. */
async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
