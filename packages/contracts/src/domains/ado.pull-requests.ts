import { z } from 'zod';
import { WorkItemIdSchema } from './ado.ids';

/**
 * Azure DevOps pull requests for the Create PR stage (AL-064; design §7 "Create PR opens the PR,
 * links it to the item and shows its checks on the card", §9 step 5 alternative, artboard 6
 * "PR open"). `@agent-lanes/ado-client` builds these; AL-065 sends them over IPC; AL-181 shows
 * "PR !10612 · 3 / 4 checks" on the card and moves the ticket to Done once the PR closes.
 */

/** ADO pull request ids are positive 32-bit integers (work items use `WorkItemIdSchema`). */
const ADO_ID_MAX = 2_147_483_647;

/** A pull request id, shown in ADO as `!10612`. */
export const PullRequestIdSchema = z.int().min(1).max(ADO_ID_MAX);
export type PullRequestId = z.infer<typeof PullRequestIdSchema>;

/** ADO refuses a longer pull request title. */
export const PULL_REQUEST_TITLE_MAX = 400;
/** ADO refuses a longer pull request description; AL-181 trims the agent's draft to fit. */
export const PULL_REQUEST_DESCRIPTION_MAX = 4_000;
/** Work items one create call links. A ticket links one; the cap keeps a bad request bounded. */
export const PULL_REQUEST_WORK_ITEMS_MAX = 50;

const REFS_HEADS = 'refs/heads/';

/**
 * A branch as git names it (`71273-cutover-job-control`); a `refs/heads/` prefix is dropped. Refuses
 * what `git check-ref-format --branch` would: spaces, control characters, `~^:?*[\`, `..`, `//`,
 * `@{`, a leading `-` or `/`, a trailing `/`, `.` or `.lock`.
 */
export const PullRequestBranchSchema = z
  .string()
  .trim()
  .transform((name) => (name.startsWith(REFS_HEADS) ? name.slice(REFS_HEADS.length) : name))
  .pipe(
    z
      .string()
      .min(1, 'A branch name is needed.')
      .max(250)
      .refine(isBranchName, 'Not a valid git branch name.'),
  );

function isBranchName(name: string): boolean {
  if (/[\s~^:?*[\\]/.test(name) || [...name].some((char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f)) return false;
  if (name.includes('..') || name.includes('//') || name.includes('@{') || name === '@') return false;
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) return false;
  return name.split('/').every((part) => part !== '' && !part.startsWith('.'));
}

/** ADO's pull request status. `completed` means merged. */
export const PULL_REQUEST_STATUSES = ['active', 'completed', 'abandoned'] as const;
export const PullRequestStatusSchema = z.enum(PULL_REQUEST_STATUSES);
export type PullRequestStatus = z.infer<typeof PullRequestStatusSchema>;

/**
 * Whether the source branch merges cleanly into the target (ADO's `PullRequestAsyncStatus`,
 * kebab-cased). `not-set` until ADO has tried, and for any value this app does not know.
 */
export const PULL_REQUEST_MERGE_STATUSES = ['not-set', 'queued', 'conflicts', 'succeeded', 'rejected-by-policy', 'failure'] as const;
export const PullRequestMergeStatusSchema = z.enum(PULL_REQUEST_MERGE_STATUSES);
export type PullRequestMergeStatus = z.infer<typeof PullRequestMergeStatusSchema>;

/** The repository a pull request belongs to. Ids are GUIDs; names are what the ADO web UI shows. */
export const PullRequestRepositorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  projectId: z.string().min(1),
  projectName: z.string().min(1),
});
export type PullRequestRepository = z.infer<typeof PullRequestRepositorySchema>;

/** One pull request as the card, the drill-in and the ADO tab use it. */
export const PullRequestSchema = z.object({
  id: PullRequestIdSchema,
  title: z.string(),
  /** Markdown, as ADO stores it; empty when there is none. */
  description: z.string(),
  status: PullRequestStatusSchema,
  mergeStatus: PullRequestMergeStatusSchema,
  isDraft: z.boolean(),
  /** Without `refs/heads/`: the ticket branch. */
  sourceBranch: z.string().min(1),
  /** Without `refs/heads/`: the repo's base branch. */
  targetBranch: z.string().min(1),
  repository: PullRequestRepositorySchema,
  createdAt: z.iso.datetime(),
  /** When it was completed or abandoned ("Merged into main · 15:20"); null while active. */
  closedAt: z.iso.datetime().nullable(),
  /** The merge commit ADO last computed; for a completed pull request, the commit that landed. */
  mergeCommitId: z.string().nullable(),
  /** Work items linked to the pull request, ascending. */
  workItemIds: z.array(WorkItemIdSchema),
  /** The pull request in the ADO web UI. Only http(s), so it is safe to open externally. */
  webUrl: z.url({ protocol: /^https?$/ }),
});
export type PullRequest = z.infer<typeof PullRequestSchema>;

/**
 * Enough to read a pull request again: project and repository by name or id. The ticket record
 * keeps it (see `pullRequestRef`).
 */
export const PullRequestRefSchema = z.object({
  project: z.string().trim().min(1),
  repository: z.string().trim().min(1),
  pullRequestId: PullRequestIdSchema,
});
export type PullRequestRef = z.infer<typeof PullRequestRefSchema>;

/** The ref of a pull request, by GUIDs so a renamed project or repository still resolves. */
export function pullRequestRef(pullRequest: Pick<PullRequest, 'id' | 'repository'>): PullRequestRef {
  return { project: pullRequest.repository.projectId, repository: pullRequest.repository.id, pullRequestId: pullRequest.id };
}

/** Create PR (AL-064 scope): source = the ticket branch, target = the base branch, linked to the work item. */
export const CreatePullRequestInputSchema = z
  .object({
    /** Project name or id. */
    project: z.string().trim().min(1),
    /** Repository name or id. */
    repository: z.string().trim().min(1),
    sourceBranch: PullRequestBranchSchema,
    targetBranch: PullRequestBranchSchema,
    title: z.string().trim().min(1, 'A pull request needs a title.').max(PULL_REQUEST_TITLE_MAX),
    description: z.string().max(PULL_REQUEST_DESCRIPTION_MAX).optional(),
    /** Linked through `workItemRefs`, then checked and linked again if ADO dropped one. */
    workItemIds: z.array(WorkItemIdSchema).max(PULL_REQUEST_WORK_ITEMS_MAX).optional(),
    isDraft: z.boolean().optional(),
  })
  .refine((input) => input.sourceBranch !== input.targetBranch, {
    message: 'The source and target branches must differ.',
    path: ['targetBranch'],
  });
export type CreatePullRequestInput = z.input<typeof CreatePullRequestInputSchema>;

export const CreatedPullRequestSchema = z.object({
  pullRequest: PullRequestSchema,
  /** False when an active pull request for the same branches already existed and was reused. */
  created: z.boolean(),
});
export type CreatedPullRequest = z.infer<typeof CreatedPullRequestSchema>;

// ── Checks ───────────────────────────────────────────────────────────────────

/** `policy`: a branch policy evaluation (build validation, reviewers, …); `status`: a status posted to the PR. */
export const PULL_REQUEST_CHECK_KINDS = ['policy', 'status'] as const;
export const PullRequestCheckKindSchema = z.enum(PULL_REQUEST_CHECK_KINDS);
export type PullRequestCheckKind = z.infer<typeof PullRequestCheckKindSchema>;

export const PULL_REQUEST_CHECK_STATES = ['passed', 'failed', 'pending'] as const;
export const PullRequestCheckStateSchema = z.enum(PULL_REQUEST_CHECK_STATES);
export type PullRequestCheckState = z.infer<typeof PullRequestCheckStateSchema>;

export const PullRequestCheckSchema = z.object({
  /** `policy:<evaluation id>` or `status:<genre>/<name>`; unique within one pull request. */
  id: z.string().min(1),
  kind: PullRequestCheckKindSchema,
  /** "Build", "Minimum number of reviewers", "sonarcloud/quality-gate". */
  name: z.string().min(1),
  state: PullRequestCheckStateSchema,
  /** A blocking policy; a status not enforced by a policy is optional. */
  required: z.boolean(),
  /** The status description, or the first build error ("CS0246: …"); null when ADO gives none. */
  detail: z.string().nullable(),
  /** Build results or the status's target page; only http(s). */
  url: z.url({ protocol: /^https?$/ }).nullable(),
});
export type PullRequestCheck = z.infer<typeof PullRequestCheckSchema>;

const PullRequestChecksShape = z.object({
  passed: z.int().min(0),
  total: z.int().min(0),
  pending: z.int().min(0),
  failing: z.array(PullRequestCheckSchema),
  checks: z.array(PullRequestCheckSchema),
});
export type PullRequestChecks = z.infer<typeof PullRequestChecksShape>;

/** `{ passed, total, failing[] }` from the ticket, plus pending and the full list for the drill-in. */
export const PullRequestChecksSchema = PullRequestChecksShape.refine(
  (summary) => {
    const expected = summarizeChecks(summary.checks);
    return (
      summary.passed === expected.passed &&
      summary.total === expected.total &&
      summary.pending === expected.pending &&
      summary.failing.length === expected.failing.length &&
      summary.failing.every((check, index) => check.id === expected.failing[index]?.id)
    );
  },
  { message: 'The counts must match the checks' },
);

/** Counts a pull request's checks. Every check counts towards `total`, required or not. */
export function summarizeChecks(checks: readonly PullRequestCheck[]): PullRequestChecks {
  return {
    passed: checks.filter((check) => check.state === 'passed').length,
    total: checks.length,
    pending: checks.filter((check) => check.state === 'pending').length,
    failing: checks.filter((check) => check.state === 'failed'),
    checks: [...checks],
  };
}

/** A pull request with its checks, as one refetch returns them. */
export const PullRequestSnapshotSchema = z.object({
  pullRequest: PullRequestSchema,
  checks: PullRequestChecksSchema,
});
export type PullRequestSnapshot = z.infer<typeof PullRequestSnapshotSchema>;

// ── Done detection and card text ─────────────────────────────────────────────

export type PullRequestOutcome = 'open' | 'merged' | 'abandoned';

/** `completed` is merged; `abandoned` closed without merging. */
export function pullRequestOutcome(pullRequest: Pick<PullRequest, 'status'>): PullRequestOutcome {
  switch (pullRequest.status) {
    case 'completed':
      return 'merged';
    case 'abandoned':
      return 'abandoned';
    default:
      return 'open';
  }
}

/** True once the pull request is completed or abandoned: the ticket moves to Done (design §9 step 6, AL-181). */
export function isPullRequestClosed(pullRequest: Pick<PullRequest, 'status'>): boolean {
  return pullRequestOutcome(pullRequest) !== 'open';
}

/** `3 / 4 checks`, `1 / 1 check`, `no checks`. */
export function formatPullRequestChecks(checks: Pick<PullRequestChecks, 'passed' | 'total'>): string {
  if (checks.total === 0) return 'no checks';
  return `${checks.passed} / ${checks.total} ${checks.total === 1 ? 'check' : 'checks'}`;
}

/**
 * The card's activity line for a pull request (artboard 6 "PR open"): `PR !10612 · 3 / 4 checks`.
 * Just `PR !10612` while the checks are unknown; `PR !10612 · merged` / `· abandoned` once closed.
 */
export function formatPullRequestActivity(
  pullRequest: Pick<PullRequest, 'id' | 'status'>,
  checks?: Pick<PullRequestChecks, 'passed' | 'total'> | null,
): string {
  const label = `PR !${pullRequest.id}`;
  const outcome = pullRequestOutcome(pullRequest);
  if (outcome !== 'open') return `${label} · ${outcome}`;
  return checks ? `${label} · ${formatPullRequestChecks(checks)}` : label;
}
