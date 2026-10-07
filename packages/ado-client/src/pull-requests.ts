import {
  CreatePullRequestInputSchema,
  ok,
  PullRequestRefSchema,
  summarizeChecks,
  type CreatedPullRequest,
  type CreatePullRequestInput,
  type PullRequest,
  type PullRequestCheck,
  type PullRequestChecks,
  type PullRequestMergeStatus,
  type PullRequestRef,
  type PullRequestSnapshot,
  type Result,
} from '@agent-lanes/contracts';
import { z } from 'zod';
import type { AdoCallOptions, AdoClient } from './client';
import { adoErr, formatIssues, isAdoErrorDetails } from './errors';
import { adoPath } from './path';

/**
 * Pull requests (AL-064, design §7 and §9 step 5 alternative): create one from the ticket branch
 * into the base branch linked to its work item, read it back, and read its checks (branch policy
 * evaluations plus the statuses builds and other services post) as `{ passed, total, failing[] }`.
 * Whether it was completed or abandoned, which moves the ticket to Done, is `isPullRequestClosed`
 * in contracts. Every call returns a `Result` and never throws.
 */

export type PullRequestCallOptions = Pick<AdoCallOptions, 'signal' | 'timeoutMs'>;

/** The Policy Evaluations and Pull Request Statuses APIs are still preview in REST 7.1. */
export const POLICY_EVALUATIONS_API_VERSION = '7.1-preview.1';
export const PULL_REQUEST_STATUSES_API_VERSION = '7.1-preview.1';

/** Policy type of "Status" branch policies, whose statuses are counted once, as the policy. */
const STATUS_POLICY_TYPE_ID = 'cbdc66da-9728-4af8-aada-9a5a32e4a226';
/** ADO's answer to a second active pull request for the same branches (TF401179). */
const PULL_REQUEST_EXISTS_TYPE_KEY = 'GitPullRequestExistsException';
const REFS_HEADS = 'refs/heads/';

// ── ADO wire shapes, read leniently: unknown enum values never fail a call ──

/** ADO sends 7 fractional digits; the DTO carries a plain ISO instant. */
const creationDateSchema = z.string().transform((value, ctx) => {
  const iso = isoDate(value);
  if (iso === null) {
    ctx.addIssue({ code: 'custom', message: 'Not a date' });
    return z.NEVER;
  }
  return iso;
});

const gitPullRequestSchema = z.object({
  pullRequestId: z.int().min(1),
  title: z.string().nullish(),
  description: z.string().nullish(),
  status: z.enum(['active', 'completed', 'abandoned']),
  mergeStatus: z.string().nullish(),
  isDraft: z.boolean().nullish(),
  sourceRefName: z.string().min(1),
  targetRefName: z.string().min(1),
  creationDate: creationDateSchema,
  closedDate: z.string().nullish(),
  lastMergeCommit: z.object({ commitId: z.string().min(1) }).nullish(),
  repository: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    project: z.object({ id: z.string().min(1), name: z.string().min(1) }),
  }),
  workItemRefs: z.array(z.object({ id: z.union([z.string(), z.number()]) })).nullish(),
});
type GitPullRequest = z.infer<typeof gitPullRequestSchema>;

const policyEvaluationSchema = z.object({
  evaluationId: z.string().min(1),
  status: z.string().nullish(),
  configuration: z
    .object({
      isEnabled: z.boolean().nullish(),
      isBlocking: z.boolean().nullish(),
      isDeleted: z.boolean().nullish(),
      type: z.object({ id: z.string().nullish(), displayName: z.string().nullish() }).nullish(),
      settings: z.record(z.string(), z.unknown()).nullish(),
    })
    .nullish(),
  context: z.record(z.string(), z.unknown()).nullish(),
});
type PolicyEvaluation = z.infer<typeof policyEvaluationSchema>;

const pullRequestStatusSchema = z.object({
  id: z.number().nullish(),
  state: z.string().nullish(),
  description: z.string().nullish(),
  context: z.object({ name: z.string().nullish(), genre: z.string().nullish() }).nullish(),
  targetUrl: z.string().nullish(),
  iterationId: z.number().nullish(),
});
type PullRequestStatusRecord = z.infer<typeof pullRequestStatusSchema>;

const buildContextSchema = z.object({
  buildId: z.number().int().positive().nullish(),
  buildOutputPreview: z
    .object({ errors: z.array(z.object({ message: z.string().nullish() })).nullish() })
    .nullish(),
});

const MERGE_STATUSES: Record<string, PullRequestMergeStatus> = {
  notSet: 'not-set',
  queued: 'queued',
  conflicts: 'conflicts',
  succeeded: 'succeeded',
  rejectedByPolicy: 'rejected-by-policy',
  failure: 'failure',
};

// ── Create ──────────────────────────────────────────────────────────────────

/**
 * Opens a pull request from the ticket branch into the base branch and links its work items.
 * Links go in the create call (`workItemRefs`); the pull request is then read back and any work
 * item ADO did not link gets an artifact link added on the work item. When an active pull request
 * for the same branches already exists (a retry after a crash), it is reused (`created: false`)
 * and linked the same way, so calling this twice never fails on the second call.
 */
export async function createPullRequest(
  client: AdoClient,
  input: CreatePullRequestInput,
  options: PullRequestCallOptions = {},
): Promise<Result<CreatedPullRequest>> {
  const parsed = CreatePullRequestInputSchema.safeParse(input);
  if (!parsed.success) {
    return adoErr('VALIDATION', `The pull request can't be created: ${parsed.error.issues[0]?.message ?? 'invalid input'}`, {
      kind: 'config',
      issues: formatIssues(parsed.error),
    });
  }
  const { project, repository, sourceBranch, targetBranch, title, description = '', workItemIds = [], isDraft = false } = parsed.data;
  const call = callOptions(options);

  const posted = await client.request({
    ...call,
    method: 'POST',
    path: adoPath`/${project}/_apis/git/repositories/${repository}/pullrequests`,
    query: { supportsIterations: true },
    body: {
      sourceRefName: REFS_HEADS + sourceBranch,
      targetRefName: REFS_HEADS + targetBranch,
      title,
      description,
      isDraft,
      workItemRefs: unique(workItemIds).map((id) => ({ id: String(id) })),
    },
    schema: gitPullRequestSchema,
  });

  let pullRequestId: number;
  let created = true;
  if (posted.ok) {
    pullRequestId = posted.data.pullRequestId;
  } else {
    if (!isPullRequestExists(posted)) return posted;
    const existing = await findActivePullRequest(client, { project, repository, sourceBranch, targetBranch }, options);
    if (!existing.ok) return existing;
    if (existing.data === null) return posted;
    pullRequestId = existing.data.id;
    created = false;
  }

  const read = await getPullRequest(client, { project, repository, pullRequestId }, options);
  if (!read.ok) return withPrefix(read, `Pull request !${pullRequestId} was ${created ? 'created' : 'found'}, but reading it back failed:`);

  const linked = await linkWorkItemsToPullRequest(client, read.data, workItemIds, options);
  if (!linked.ok) return withPrefix(linked, `Pull request !${pullRequestId} was ${created ? 'created' : 'found'}, but linking its work items failed:`);
  return ok({ pullRequest: linked.data, created });
}

/** The active pull request from `sourceBranch` into `targetBranch`, or null when there is none. */
export async function findActivePullRequest(
  client: AdoClient,
  scope: { project: string; repository: string; sourceBranch: string; targetBranch: string },
  options: PullRequestCallOptions = {},
): Promise<Result<PullRequest | null>> {
  const { project, repository } = scope;
  if (!isName(project) || !isName(repository)) return missing('A project and repository are needed to look up a pull request.');
  const found = await client.get(adoPath`/${project.trim()}/_apis/git/repositories/${repository.trim()}/pullrequests`, z.object({ value: z.array(gitPullRequestSchema) }), {
    ...callOptions(options),
    query: {
      'searchCriteria.sourceRefName': toRef(scope.sourceBranch),
      'searchCriteria.targetRefName': toRef(scope.targetBranch),
      'searchCriteria.status': 'active',
      $top: 1,
    },
  });
  if (!found.ok) return found;
  const first = found.data.value[0];
  return ok(first ? toPullRequest(client, first) : null);
}

// ── Read ────────────────────────────────────────────────────────────────────

/** One pull request with its linked work items. */
export async function getPullRequest(client: AdoClient, ref: PullRequestRef, options: PullRequestCallOptions = {}): Promise<Result<PullRequest>> {
  const parsed = PullRequestRefSchema.safeParse(ref);
  if (!parsed.success) return missing('A project, repository and pull request id are needed to read a pull request.');
  const { project, repository, pullRequestId } = parsed.data;

  const read = await client.get(adoPath`/${project}/_apis/git/repositories/${repository}/pullrequests/${pullRequestId}`, gitPullRequestSchema, {
    ...callOptions(options),
    query: { includeWorkItemRefs: true },
  });
  return read.ok ? ok(toPullRequest(client, read.data)) : read;
}

/**
 * A pull request's checks: every enabled branch policy that applies to it (build validation,
 * reviewers, linked work items, comments, status policies) and the latest status per context that
 * no status policy already covers. Approved/succeeded checks pass; rejected, broken, failed and
 * error checks fail; queued, running and pending ones are pending; not-applicable ones don't count.
 */
export async function getPullRequestChecks(
  client: AdoClient,
  pullRequest: Pick<PullRequest, 'id' | 'repository'>,
  options: PullRequestCallOptions = {},
): Promise<Result<PullRequestChecks>> {
  const { id, repository } = pullRequest;
  const call = callOptions(options);
  const [evaluations, statuses] = await Promise.all([
    client.list(adoPath`/${repository.projectId}/_apis/policy/evaluations`, policyEvaluationSchema, {
      ...call,
      apiVersion: POLICY_EVALUATIONS_API_VERSION,
      query: { artifactId: `vstfs:///CodeReview/CodeReviewId/${repository.projectId}/${id}` },
    }),
    client.list(adoPath`/${repository.projectId}/_apis/git/repositories/${repository.id}/pullRequests/${id}/statuses`, pullRequestStatusSchema, {
      ...call,
      apiVersion: PULL_REQUEST_STATUSES_API_VERSION,
    }),
  ]);
  if (!evaluations.ok) return evaluations;
  if (!statuses.ok) return statuses;

  const buildResultsUrl = (buildId: number) => `${client.orgUrl}${adoPath`/${repository.projectName}/_build/results`}?buildId=${buildId}`;
  const policyChecks: PullRequestCheck[] = [];
  const coveredStatuses = new Set<string>();
  for (const evaluation of evaluations.data) {
    const check = toPolicyCheck(evaluation, buildResultsUrl);
    if (!check) continue;
    policyChecks.push(check);
    const covered = statusPolicyKey(evaluation);
    if (covered) coveredStatuses.add(covered);
  }

  const statusChecks = latestPerContext(statuses.data)
    .filter(([key]) => !coveredStatuses.has(key))
    .map(([key, status]) => toStatusCheck(key, status))
    .filter((check): check is PullRequestCheck => check !== null);

  // Required policies first, as ADO's PR page lists them; ADO's order otherwise.
  return ok(summarizeChecks([...policyChecks.toSorted((a, b) => Number(b.required) - Number(a.required)), ...statusChecks]));
}

/** The pull request and its checks, as the card and the drill-in refetch them. */
export async function getPullRequestSnapshot(
  client: AdoClient,
  ref: PullRequestRef,
  options: PullRequestCallOptions = {},
): Promise<Result<PullRequestSnapshot>> {
  const pullRequest = await getPullRequest(client, ref, options);
  if (!pullRequest.ok) return pullRequest;
  const checks = await getPullRequestChecks(client, pullRequest.data, options);
  if (!checks.ok) return checks;
  return ok({ pullRequest: pullRequest.data, checks: checks.data });
}

// ── Link ────────────────────────────────────────────────────────────────────

/**
 * Links work items to a pull request: each id not yet in `pullRequest.workItemIds` gets an
 * artifact link to the pull request added on the work item (what ADO's "Link work items" does).
 * The work item is addressed at organisation level, since it may live in another project than the
 * repository. Returns the pull request with the linked ids.
 */
export async function linkWorkItemsToPullRequest(
  client: AdoClient,
  pullRequest: PullRequest,
  workItemIds: readonly number[],
  options: PullRequestCallOptions = {},
): Promise<Result<PullRequest>> {
  const linked = new Set(pullRequest.workItemIds);
  const missingIds = unique(workItemIds).filter((id) => !linked.has(id));
  const { repository } = pullRequest;
  const artifactUrl = `vstfs:///Git/PullRequestId/${repository.projectId}%2F${repository.id}%2F${pullRequest.id}`;

  for (const workItemId of missingIds) {
    const added = await client.request({
      ...callOptions(options),
      method: 'PATCH',
      path: adoPath`/_apis/wit/workitems/${workItemId}`,
      contentType: 'application/json-patch+json',
      body: [{ op: 'add', path: '/relations/-', value: { rel: 'ArtifactLink', url: artifactUrl, attributes: { name: 'Pull Request' } } }],
      schema: z.object({ id: z.number() }),
    });
    if (!added.ok) return withPrefix(added, `Work item #${workItemId}:`);
    linked.add(workItemId);
  }
  return ok({ ...pullRequest, workItemIds: [...linked].toSorted((a, b) => a - b) });
}

// ── Mapping ─────────────────────────────────────────────────────────────────

function toPullRequest(client: AdoClient, pr: GitPullRequest): PullRequest {
  const { repository } = pr;
  const workItemIds = (pr.workItemRefs ?? []).map((ref) => Number(ref.id)).filter((id) => Number.isInteger(id) && id > 0 && id <= 2_147_483_647);
  return {
    id: pr.pullRequestId,
    title: pr.title ?? '',
    description: pr.description ?? '',
    status: pr.status,
    mergeStatus: MERGE_STATUSES[pr.mergeStatus ?? ''] ?? 'not-set',
    isDraft: pr.isDraft ?? false,
    sourceBranch: fromRef(pr.sourceRefName),
    targetBranch: fromRef(pr.targetRefName),
    repository: { id: repository.id, name: repository.name, projectId: repository.project.id, projectName: repository.project.name },
    createdAt: pr.creationDate,
    closedAt: pr.status === 'active' ? null : isoDate(pr.closedDate),
    mergeCommitId: pr.lastMergeCommit?.commitId ?? null,
    workItemIds: unique(workItemIds).toSorted((a, b) => a - b),
    webUrl: `${client.orgUrl}${adoPath`/${repository.project.name}/_git/${repository.name}/pullrequest/${pr.pullRequestId}`}`,
  };
}

function toPolicyCheck(evaluation: PolicyEvaluation, buildResultsUrl: (buildId: number) => string): PullRequestCheck | null {
  const configuration = evaluation.configuration;
  if (configuration?.isEnabled === false || configuration?.isDeleted === true) return null;
  const state = policyState(evaluation.status);
  if (state === null) return null;

  const settings = configuration?.settings ?? {};
  const statusName = text(settings['statusName']);
  const statusGenre = text(settings['statusGenre']);
  const enforcedStatus = isStatusPolicy(evaluation) && statusName ? (statusGenre ? `${statusGenre}/${statusName}` : statusName) : null;
  const name = text(settings['displayName']) ?? text(settings['defaultDisplayName']) ?? enforcedStatus ?? text(configuration?.type?.displayName) ?? 'Policy';
  const build = buildContextSchema.safeParse(evaluation.context ?? {});
  const buildId = build.success ? build.data.buildId : null;
  const firstError = build.success ? text(build.data.buildOutputPreview?.errors?.find((error) => text(error.message))?.message) : null;
  return {
    id: `policy:${evaluation.evaluationId}`,
    kind: 'policy',
    name,
    state,
    required: configuration?.isBlocking ?? false,
    detail: state === 'failed' ? firstError : null,
    url: buildId ? buildResultsUrl(buildId) : null,
  };
}

/** `null`: not applicable to this pull request, so not counted. */
function policyState(status: string | null | undefined): PullRequestCheck['state'] | null {
  switch (status) {
    case 'approved':
      return 'passed';
    case 'rejected':
    case 'broken':
      return 'failed';
    case 'notApplicable':
      return null;
    default:
      return 'pending';
  }
}

/** The status a "Status" policy enforces, as a context key, so the status itself is not counted twice. */
function statusPolicyKey(evaluation: PolicyEvaluation): string | null {
  if (!isStatusPolicy(evaluation)) return null;
  const settings = evaluation.configuration?.settings ?? {};
  const name = text(settings['statusName']);
  return name ? contextKey(text(settings['statusGenre']), name) : null;
}

function isStatusPolicy(evaluation: PolicyEvaluation): boolean {
  return evaluation.configuration?.type?.id?.toLowerCase() === STATUS_POLICY_TYPE_ID;
}

/** ADO keeps every status ever posted; the latest per context (genre + name) is the current one. */
function latestPerContext(statuses: readonly PullRequestStatusRecord[]): Array<[string, PullRequestStatusRecord]> {
  const latest = new Map<string, PullRequestStatusRecord>();
  for (const status of statuses) {
    const name = text(status.context?.name);
    if (!name) continue;
    const key = contextKey(text(status.context?.genre), name);
    const previous = latest.get(key);
    if (!previous || isNewer(status, previous)) latest.set(key, status);
  }
  return [...latest.entries()];
}

function isNewer(a: PullRequestStatusRecord, b: PullRequestStatusRecord): boolean {
  const iterationA = a.iterationId ?? 0;
  const iterationB = b.iterationId ?? 0;
  if (iterationA !== iterationB) return iterationA > iterationB;
  return (a.id ?? 0) >= (b.id ?? 0);
}

function toStatusCheck(key: string, status: PullRequestStatusRecord): PullRequestCheck | null {
  const state = statusState(status.state);
  if (state === null) return null;
  const genre = text(status.context?.genre);
  const name = text(status.context?.name) ?? key;
  return {
    id: `status:${key}`,
    kind: 'status',
    name: genre ? `${genre}/${name}` : name,
    state,
    required: false,
    detail: text(status.description),
    url: httpUrl(status.targetUrl),
  };
}

/** `partiallySucceeded` passes, as a partially succeeded build satisfies ADO's build policy. */
function statusState(state: string | null | undefined): PullRequestCheck['state'] | null {
  switch (state) {
    case 'succeeded':
    case 'partiallySucceeded':
      return 'passed';
    case 'failed':
    case 'error':
      return 'failed';
    case 'notApplicable':
      return null;
    default:
      return 'pending';
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isPullRequestExists(result: Result<unknown>): boolean {
  if (result.ok || !isAdoErrorDetails(result.details)) return false;
  const { status, adoTypeKey, adoMessage } = result.details;
  return status === 409 && (adoTypeKey === PULL_REQUEST_EXISTS_TYPE_KEY || (adoMessage ?? '').startsWith('TF401179'));
}

function withPrefix<T>(result: Result<T>, prefix: string): Result<T> {
  return result.ok ? result : { ...result, message: `${prefix} ${result.message}` };
}

/** `genre/name`, or `name` without a genre; lower-case, so a status policy matches its status whatever the casing. */
function contextKey(genre: string | null, name: string): string {
  return (genre ? `${genre}/${name}` : name).toLowerCase();
}

function toRef(branch: string): string {
  const name = branch.trim();
  return name.startsWith(REFS_HEADS) ? name : REFS_HEADS + name;
}

function fromRef(ref: string): string {
  return ref.startsWith(REFS_HEADS) ? ref.slice(REFS_HEADS.length) : ref;
}

/** ADO sends 7 fractional digits and `0001-01-01T00:00:00` for "never"; both become an ISO instant or null. */
function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null;
}

function httpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function unique(ids: readonly number[]): number[] {
  return [...new Set(ids)];
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function missing(message: string) {
  return adoErr('VALIDATION', message, { kind: 'config' });
}

function callOptions({ signal, timeoutMs }: PullRequestCallOptions): PullRequestCallOptions {
  return { ...(signal ? { signal } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
}
