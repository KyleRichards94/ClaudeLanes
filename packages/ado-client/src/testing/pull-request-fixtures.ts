/**
 * Test-only ADO wire data for pull requests (AL-064), shaped like REST 7.1 answers and matching
 * artboard 6 "PR open": PR !10612 from the ticket branch of #71273 into main, with 3 of 4 checks
 * passed. AL-065 can lift these into the shared MSW fixture set.
 */
import { ORG_URL } from './constants';

export const PROJECT_ID = '6ce954b1-ce1f-45d1-b94d-e6bf2464ba2c';
export const PROJECT_NAME = 'Onsite Companion';
export const REPO_ID = '3411ebc1-d5aa-464f-9615-0b527bc66719';
export const REPO_NAME = 'OnSite';
export const PR_ID = 10612;
export const WORK_ITEM_ID = 71273;
export const SOURCE_BRANCH = '71273-cutover-job-control';
export const TARGET_BRANCH = 'main';

export const BUILD_POLICY_TYPE = { id: '0609b952-1397-4640-95ec-e00a01b2c241', displayName: 'Build' };
export const REVIEWERS_POLICY_TYPE = { id: 'fa4e907d-c16b-4a4c-9dfa-4906e5d171dd', displayName: 'Minimum number of reviewers' };
export const WORK_ITEM_LINKING_POLICY_TYPE = { id: '40e92b44-2fe1-4dd6-b3d8-74a9c21d0c6e', displayName: 'Work item linking' };
export const COMMENTS_POLICY_TYPE = { id: 'c6a1889d-b943-4856-b76f-9e46bb6b0df2', displayName: 'Comment requirements' };
export const STATUS_POLICY_TYPE = { id: 'cbdc66da-9728-4af8-aada-9a5a32e4a226', displayName: 'Status' };

/** `/{project}/_apis/git/repositories/{repo}` as MSW matches it, by name or by id. */
export const REPO_PATH = `${ORG_URL}/:project/_apis/git/repositories/:repository`;

/** An ADO `GitPullRequest` as the create, get and list endpoints return it. */
export function gitPullRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pullRequestId: PR_ID,
    codeReviewId: PR_ID,
    status: 'active',
    title: 'Cutover frmJobControl to Blazor',
    description: 'Moves the job control screen to Blazor.\n\nAB#71273',
    isDraft: false,
    mergeStatus: 'succeeded',
    sourceRefName: `refs/heads/${SOURCE_BRANCH}`,
    targetRefName: `refs/heads/${TARGET_BRANCH}`,
    creationDate: '2026-10-07T04:12:31.4416667Z',
    lastMergeCommit: { commitId: 'b4f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9', url: `${ORG_URL}/_apis/git/commits/b4f1` },
    createdBy: { displayName: 'Test User', uniqueName: 'test.user@example.com' },
    repository: {
      id: REPO_ID,
      name: REPO_NAME,
      url: `${ORG_URL}/${PROJECT_ID}/_apis/git/repositories/${REPO_ID}`,
      project: { id: PROJECT_ID, name: PROJECT_NAME, state: 'wellFormed', visibility: 'private' },
    },
    workItemRefs: [{ id: String(WORK_ITEM_ID), url: `${ORG_URL}/_apis/wit/workItems/${WORK_ITEM_ID}` }],
    url: `${ORG_URL}/${PROJECT_ID}/_apis/git/repositories/${REPO_ID}/pullRequests/${PR_ID}`,
    supportsIterations: true,
    ...overrides,
  };
}

let evaluationSeq = 0;

/** An ADO `PolicyEvaluationRecord`. */
export function policyEvaluation(
  type: { id: string; displayName: string },
  status: string,
  options: { isBlocking?: boolean; isEnabled?: boolean; isDeleted?: boolean; settings?: Record<string, unknown>; context?: Record<string, unknown> } = {},
): Record<string, unknown> {
  evaluationSeq += 1;
  return {
    evaluationId: `00000000-0000-4000-8000-${String(evaluationSeq).padStart(12, '0')}`,
    artifactId: `vstfs:///CodeReview/CodeReviewId/${PROJECT_ID}/${PR_ID}`,
    status,
    startedDate: '2026-10-07T04:12:40.123Z',
    configuration: {
      id: evaluationSeq,
      revision: 1,
      isEnabled: options.isEnabled ?? true,
      isBlocking: options.isBlocking ?? true,
      isDeleted: options.isDeleted ?? false,
      type: { ...type, url: `${ORG_URL}/_apis/policy/types/${type.id}` },
      settings: { scope: [{ refName: 'refs/heads/main', matchKind: 'Exact', repositoryId: REPO_ID }], ...options.settings },
    },
    ...(options.context ? { context: options.context } : {}),
  };
}

/** An ADO `GitPullRequestStatus`. */
export function pullRequestStatus(
  genre: string | null,
  name: string,
  state: string,
  options: { id?: number; iterationId?: number; description?: string; targetUrl?: string } = {},
): Record<string, unknown> {
  return {
    id: options.id ?? 1,
    state,
    description: options.description ?? `${name} ${state}`,
    context: genre === null ? { name } : { genre, name },
    ...(options.iterationId !== undefined ? { iterationId: options.iterationId } : {}),
    ...(options.targetUrl !== undefined ? { targetUrl: options.targetUrl } : {}),
    creationDate: '2026-10-07T04:20:00Z',
    updatedDate: '2026-10-07T04:20:00Z',
  };
}

/**
 * Artboard 6 "PR open" → "3 / 4 checks": the build, linking and comment policies pass, the
 * reviewer policy waits for an approval; a path-filtered build is not applicable and a disabled
 * policy is ignored.
 */
export function artboardPolicyEvaluations(): Array<Record<string, unknown>> {
  return [
    policyEvaluation(BUILD_POLICY_TYPE, 'approved', { settings: { buildDefinitionId: 12, displayName: 'OnSite CI' }, context: { buildId: 4512, buildDefinitionId: 12 } }),
    policyEvaluation(REVIEWERS_POLICY_TYPE, 'running', { settings: { minimumApproverCount: 1 } }),
    policyEvaluation(WORK_ITEM_LINKING_POLICY_TYPE, 'approved'),
    policyEvaluation(COMMENTS_POLICY_TYPE, 'approved', { isBlocking: false }),
    policyEvaluation(BUILD_POLICY_TYPE, 'notApplicable', { settings: { buildDefinitionId: 13, displayName: 'Docs build' } }),
    policyEvaluation(BUILD_POLICY_TYPE, 'queued', { isEnabled: false, settings: { buildDefinitionId: 14, displayName: 'Old build' } }),
  ];
}
