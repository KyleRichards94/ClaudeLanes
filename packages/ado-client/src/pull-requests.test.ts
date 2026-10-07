import {
  formatPullRequestActivity,
  isPullRequestClosed,
  PullRequestChecksSchema,
  PullRequestSchema,
  PullRequestSnapshotSchema,
  pullRequestOutcome,
  pullRequestRef,
  type PullRequest,
} from '@agent-lanes/contracts';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { isAdoErrorDetails } from './errors';
import {
  createPullRequest,
  findActivePullRequest,
  getPullRequest,
  getPullRequestChecks,
  getPullRequestSnapshot,
  linkWorkItemsToPullRequest,
} from './pull-requests';
import { createTestClient, FAKE_PAT, ORG_URL, useMswServer } from './testing/msw-server';
import {
  artboardPolicyEvaluations,
  BUILD_POLICY_TYPE,
  COMMENTS_POLICY_TYPE,
  gitPullRequest,
  policyEvaluation,
  PR_ID,
  PROJECT_ID,
  PROJECT_NAME,
  pullRequestStatus,
  REPO_ID,
  REPO_NAME,
  REPO_PATH,
  REVIEWERS_POLICY_TYPE,
  SOURCE_BRANCH,
  STATUS_POLICY_TYPE,
  TARGET_BRANCH,
  WORK_ITEM_ID,
  WORK_ITEM_LINKING_POLICY_TYPE,
} from './testing/pull-request-fixtures';

const server = useMswServer();

const CREATE_INPUT = {
  project: PROJECT_NAME,
  repository: REPO_NAME,
  sourceBranch: SOURCE_BRANCH,
  targetBranch: TARGET_BRANCH,
  title: 'Cutover frmJobControl to Blazor',
  description: 'Moves the job control screen to Blazor.',
  workItemIds: [WORK_ITEM_ID],
};

const REF = { project: PROJECT_NAME, repository: REPO_NAME, pullRequestId: PR_ID };

/** What `getPullRequest` makes of `gitPullRequest()`. */
const EXPECTED_PR: PullRequest = {
  id: PR_ID,
  title: 'Cutover frmJobControl to Blazor',
  description: 'Moves the job control screen to Blazor.\n\nAB#71273',
  status: 'active',
  mergeStatus: 'succeeded',
  isDraft: false,
  sourceBranch: SOURCE_BRANCH,
  targetBranch: TARGET_BRANCH,
  repository: { id: REPO_ID, name: REPO_NAME, projectId: PROJECT_ID, projectName: PROJECT_NAME },
  createdAt: '2026-10-07T04:12:31.441Z',
  closedAt: null,
  mergeCommitId: 'b4f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9',
  workItemIds: [WORK_ITEM_ID],
  webUrl: `${ORG_URL}/Onsite%20Companion/_git/OnSite/pullrequest/${PR_ID}`,
};

interface Seen {
  method: string;
  url: URL;
  contentType: string | null;
  body: unknown;
}

/** Records every request MSW answers. */
function recorder() {
  const seen: Seen[] = [];
  const record = async (request: Request) => {
    const text = request.method === 'GET' ? '' : await request.text();
    seen.push({ method: request.method, url: new URL(request.url), contentType: request.headers.get('content-type'), body: text ? JSON.parse(text) : undefined });
  };
  return { seen, record };
}

/** The PR endpoints answering with `pr` for create and get. */
function prHandlers(record: (request: Request) => Promise<void>, pr: () => Record<string, unknown> = () => gitPullRequest()) {
  return [
    http.post(`${REPO_PATH}/pullrequests`, async ({ request }) => {
      await record(request);
      return HttpResponse.json(pr(), { status: 201 });
    }),
    http.get(`${REPO_PATH}/pullrequests/:id`, async ({ request }) => {
      await record(request);
      return HttpResponse.json(pr());
    }),
  ];
}

function checkHandlers(evaluations: () => unknown[], statuses: () => unknown[] = () => [], record?: (request: Request) => Promise<void>) {
  return [
    http.get(`${ORG_URL}/:project/_apis/policy/evaluations`, async ({ request }) => {
      await record?.(request);
      const value = evaluations();
      return HttpResponse.json({ count: value.length, value });
    }),
    http.get(`${REPO_PATH}/pullRequests/:id/statuses`, async ({ request }) => {
      await record?.(request);
      const value = statuses();
      return HttpResponse.json({ count: value.length, value });
    }),
  ];
}

describe('createPullRequest', () => {
  it('opens a PR from the ticket branch into the base branch with the work item in workItemRefs', async () => {
    const { seen, record } = recorder();
    server.use(...prHandlers(record));
    const { client } = createTestClient();

    const result = await createPullRequest(client, CREATE_INPUT);

    expect(result).toEqual({ ok: true, data: { pullRequest: EXPECTED_PR, created: true } });
    expect(PullRequestSchema.parse(result.ok && result.data.pullRequest)).toEqual(EXPECTED_PR);

    const [post, get] = seen;
    expect(seen).toHaveLength(2);
    expect(post?.method).toBe('POST');
    expect(post?.url.pathname).toBe('/contoso/Onsite%20Companion/_apis/git/repositories/OnSite/pullrequests');
    expect(post?.url.searchParams.get('supportsIterations')).toBe('true');
    expect(post?.url.searchParams.get('api-version')).toBe('7.1');
    expect(post?.contentType).toBe('application/json');
    expect(post?.body).toEqual({
      sourceRefName: `refs/heads/${SOURCE_BRANCH}`,
      targetRefName: 'refs/heads/main',
      title: 'Cutover frmJobControl to Blazor',
      description: 'Moves the job control screen to Blazor.',
      isDraft: false,
      workItemRefs: [{ id: '71273' }],
    });
    // Read back with its links, which also confirms ADO linked the work item.
    expect(get?.url.pathname).toBe(`/contoso/Onsite%20Companion/_apis/git/repositories/OnSite/pullrequests/${PR_ID}`);
    expect(get?.url.searchParams.get('includeWorkItemRefs')).toBe('true');
  });

  it('accepts refs/heads/ branch names, trims the title and defaults description, links and draft', async () => {
    const { seen, record } = recorder();
    server.use(...prHandlers(record, () => gitPullRequest({ workItemRefs: [] })));
    const { client } = createTestClient();

    const result = await createPullRequest(client, {
      project: PROJECT_NAME,
      repository: REPO_NAME,
      sourceBranch: `refs/heads/${SOURCE_BRANCH}`,
      targetBranch: 'refs/heads/main',
      title: '  Cutover  ',
    });

    expect(result.ok).toBe(true);
    expect(seen[0]?.body).toMatchObject({
      sourceRefName: `refs/heads/${SOURCE_BRANCH}`,
      targetRefName: 'refs/heads/main',
      title: 'Cutover',
      description: '',
      isDraft: false,
      workItemRefs: [],
    });
  });

  it('links a work item ADO left unlinked with an artifact link on the work item', async () => {
    const { seen, record } = recorder();
    server.use(
      ...prHandlers(record, () => gitPullRequest({ workItemRefs: [] })),
      http.patch(`${ORG_URL}/_apis/wit/workitems/:id`, async ({ request, params }) => {
        await record(request);
        return HttpResponse.json({ id: Number(params['id']), rev: 7 });
      }),
    );
    const { client } = createTestClient();

    const result = await createPullRequest(client, CREATE_INPUT);

    expect(result.ok && result.data.pullRequest.workItemIds).toEqual([WORK_ITEM_ID]);
    const patch = seen.find((request) => request.method === 'PATCH');
    expect(patch?.url.pathname).toBe(`/contoso/_apis/wit/workitems/${WORK_ITEM_ID}`);
    expect(patch?.contentType).toBe('application/json-patch+json');
    expect(patch?.body).toEqual([
      {
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'ArtifactLink',
          url: `vstfs:///Git/PullRequestId/${PROJECT_ID}%2F${REPO_ID}%2F${PR_ID}`,
          attributes: { name: 'Pull Request' },
        },
      },
    ]);
  });

  it('reuses the active PR for the same branches when ADO says one exists (TF401179)', async () => {
    const { seen, record } = recorder();
    server.use(
      http.post(`${REPO_PATH}/pullrequests`, async ({ request }) => {
        await record(request);
        return HttpResponse.json(
          {
            message: `TF401179: An active pull request for the source and target branch already exists.`,
            typeKey: 'GitPullRequestExistsException',
          },
          { status: 409 },
        );
      }),
      http.get(`${REPO_PATH}/pullrequests`, async ({ request }) => {
        await record(request);
        return HttpResponse.json({ count: 1, value: [gitPullRequest({ workItemRefs: undefined })] });
      }),
      http.get(`${REPO_PATH}/pullrequests/:id`, async ({ request }) => {
        await record(request);
        return HttpResponse.json(gitPullRequest());
      }),
    );
    const { client } = createTestClient();

    const result = await createPullRequest(client, CREATE_INPUT);

    expect(result).toEqual({ ok: true, data: { pullRequest: EXPECTED_PR, created: false } });
    const search = seen.find((request) => request.method === 'GET' && request.url.pathname.endsWith('/pullrequests'));
    expect(Object.fromEntries(search?.url.searchParams ?? [])).toMatchObject({
      'searchCriteria.sourceRefName': `refs/heads/${SOURCE_BRANCH}`,
      'searchCriteria.targetRefName': 'refs/heads/main',
      'searchCriteria.status': 'active',
    });
  });

  it('returns the conflict when ADO says a PR exists but none is active any more', async () => {
    server.use(
      http.post(`${REPO_PATH}/pullrequests`, () =>
        HttpResponse.json({ message: 'TF401179: An active pull request already exists.', typeKey: 'GitPullRequestExistsException' }, { status: 409 }),
      ),
      http.get(`${REPO_PATH}/pullrequests`, () => HttpResponse.json({ count: 0, value: [] })),
    );
    const { client } = createTestClient();

    const result = await createPullRequest(client, CREATE_INPUT);

    expect(result).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(!result.ok && isAdoErrorDetails(result.details) && result.details.status).toBe(409);
  });

  it.each([
    ['the same source and target', { targetBranch: SOURCE_BRANCH }],
    ['a branch with a space', { sourceBranch: 'my branch' }],
    ['a branch with ..', { sourceBranch: 'a..b' }],
    ['a branch ending in .lock', { sourceBranch: 'feature.lock' }],
    ['an empty title', { title: '   ' }],
    ['a title over 400 characters', { title: 'x'.repeat(401) }],
    ['a description over 4000 characters', { description: 'x'.repeat(4001) }],
    ['a work item id of 0', { workItemIds: [0] }],
    ['no project', { project: ' ' }],
  ])('refuses %s without calling ADO', async (_case, change) => {
    const { seen, record } = recorder();
    server.use(...prHandlers(record));
    const { client } = createTestClient();

    const result = await createPullRequest(client, { ...CREATE_INPUT, ...change });

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(seen).toHaveLength(0);
  });

  it('passes a 401 through as ADO_UNAUTHORIZED without the PAT', async () => {
    server.use(http.post(`${REPO_PATH}/pullrequests`, () => new HttpResponse(null, { status: 401 })));
    const { client } = createTestClient();

    const result = await createPullRequest(client, CREATE_INPUT);

    expect(result).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });
    expect(JSON.stringify(result)).not.toContain(FAKE_PAT);
  });

  it('passes a missing source branch (400) through as VALIDATION with ADO’s message', async () => {
    server.use(
      http.post(`${REPO_PATH}/pullrequests`, () =>
        HttpResponse.json({ message: 'TF401398: The pull request cannot be activated because the source and/or the target branch no longer exists.' }, { status: 400 }),
      ),
    );
    const { client } = createTestClient();

    const result = await createPullRequest(client, CREATE_INPUT);

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(!result.ok && result.message).toContain('TF401398');
  });

  it('says the PR was created when reading it back fails, so a retry reuses it', async () => {
    server.use(
      http.post(`${REPO_PATH}/pullrequests`, () => HttpResponse.json(gitPullRequest(), { status: 201 })),
      http.get(`${REPO_PATH}/pullrequests/:id`, () => new HttpResponse(null, { status: 500 })),
    );
    const { client } = createTestClient();

    const result = await createPullRequest(client, CREATE_INPUT);

    expect(result).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(!result.ok && result.message).toMatch(/^Pull request !10612 was created, but reading it back failed:/);
  });

  it('says the PR was created when linking fails, keeping the error code', async () => {
    server.use(
      ...prHandlers(async () => {}, () => gitPullRequest({ workItemRefs: [] })),
      http.patch(`${ORG_URL}/_apis/wit/workitems/:id`, () => new HttpResponse(null, { status: 403 })),
    );
    const { client } = createTestClient();

    const result = await createPullRequest(client, CREATE_INPUT);

    expect(result).toMatchObject({ ok: false, code: 'ADO_SCOPE_MISSING' });
    expect(!result.ok && result.message).toMatch(/^Pull request !10612 was created, but linking its work items failed: Work item #71273:/);
  });
});

describe('findActivePullRequest', () => {
  it('returns null when there is no active PR for the branches', async () => {
    server.use(http.get(`${REPO_PATH}/pullrequests`, () => HttpResponse.json({ count: 0, value: [] })));
    const { client } = createTestClient();

    const result = await findActivePullRequest(client, { project: PROJECT_NAME, repository: REPO_NAME, sourceBranch: SOURCE_BRANCH, targetBranch: 'main' });

    expect(result).toEqual({ ok: true, data: null });
  });

  it('refuses a blank project or repository', async () => {
    const { client } = createTestClient();
    const result = await findActivePullRequest(client, { project: '', repository: REPO_NAME, sourceBranch: SOURCE_BRANCH, targetBranch: 'main' });
    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
  });
});

describe('getPullRequest', () => {
  it('reads an active PR', async () => {
    server.use(...prHandlers(async () => {}));
    const { client } = createTestClient();

    const result = await getPullRequest(client, REF);

    expect(result).toEqual({ ok: true, data: EXPECTED_PR });
    expect(result.ok && isPullRequestClosed(result.data)).toBe(false);
  });

  it('reads a completed PR as merged, with when it closed and the merge commit', async () => {
    server.use(...prHandlers(async () => {}, () => gitPullRequest({ status: 'completed', closedDate: '2026-10-07T05:20:11.9033333Z' })));
    const { client } = createTestClient();

    const result = await getPullRequest(client, REF);

    expect(result.ok && result.data).toMatchObject({ status: 'completed', closedAt: '2026-10-07T05:20:11.903Z', mergeCommitId: EXPECTED_PR.mergeCommitId });
    expect(result.ok && pullRequestOutcome(result.data)).toBe('merged');
    expect(result.ok && isPullRequestClosed(result.data)).toBe(true);
  });

  it('reads an abandoned PR as closed without merging', async () => {
    server.use(...prHandlers(async () => {}, () => gitPullRequest({ status: 'abandoned', closedDate: '2026-10-08T01:00:00Z', mergeStatus: 'conflicts' })));
    const { client } = createTestClient();

    const result = await getPullRequest(client, REF);

    expect(result.ok && result.data).toMatchObject({ status: 'abandoned', mergeStatus: 'conflicts', closedAt: '2026-10-08T01:00:00.000Z' });
    expect(result.ok && pullRequestOutcome(result.data)).toBe('abandoned');
  });

  it.each([
    ['notSet', 'not-set'],
    ['queued', 'queued'],
    ['conflicts', 'conflicts'],
    ['rejectedByPolicy', 'rejected-by-policy'],
    ['failure', 'failure'],
    ['somethingNew', 'not-set'],
    [undefined, 'not-set'],
  ])('maps merge status %s to %s', async (mergeStatus, expected) => {
    server.use(...prHandlers(async () => {}, () => gitPullRequest({ mergeStatus })));
    const { client } = createTestClient();
    const result = await getPullRequest(client, REF);
    expect(result.ok && result.data.mergeStatus).toBe(expected);
  });

  it('reads missing optional fields leniently: no title, description, draft flag, merge commit or links', async () => {
    server.use(
      ...prHandlers(async () => {}, () =>
        gitPullRequest({ title: null, description: undefined, isDraft: undefined, lastMergeCommit: undefined, workItemRefs: undefined, closedDate: '0001-01-01T00:00:00' }),
      ),
    );
    const { client } = createTestClient();

    const result = await getPullRequest(client, REF);

    expect(result.ok && result.data).toMatchObject({ title: '', description: '', isDraft: false, mergeCommitId: null, workItemIds: [], closedAt: null });
  });

  it('refuses a PR status it does not know rather than guess whether the ticket is done', async () => {
    server.use(...prHandlers(async () => {}, () => gitPullRequest({ status: 'notSet' })));
    const { client } = createTestClient();

    const result = await getPullRequest(client, REF);

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(!result.ok && isAdoErrorDetails(result.details) && result.details.kind).toBe('schema');
  });

  it('passes a 404 through with its status', async () => {
    server.use(
      http.get(`${REPO_PATH}/pullrequests/:id`, () =>
        HttpResponse.json({ message: 'TF401180: The requested pull request was not found.', typeKey: 'GitPullRequestNotFoundException' }, { status: 404 }),
      ),
    );
    const { client } = createTestClient();

    const result = await getPullRequest(client, REF);

    expect(result).toMatchObject({ ok: false, code: 'INTERNAL' });
    expect(!result.ok && isAdoErrorDetails(result.details) && result.details).toMatchObject({ status: 404, adoTypeKey: 'GitPullRequestNotFoundException' });
  });

  it.each([
    ['no project', { ...REF, project: '' }],
    ['no repository', { ...REF, repository: ' ' }],
    ['a PR id of 0', { ...REF, pullRequestId: 0 }],
  ])('refuses a ref with %s', async (_case, ref) => {
    const { client } = createTestClient();
    expect(await getPullRequest(client, ref)).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('re-reads by the ids pullRequestRef keeps', async () => {
    let path = '';
    server.use(
      http.get(`${REPO_PATH}/pullrequests/:id`, ({ request }) => {
        path = new URL(request.url).pathname;
        return HttpResponse.json(gitPullRequest());
      }),
    );
    const { client } = createTestClient();

    const result = await getPullRequest(client, pullRequestRef(EXPECTED_PR));

    expect(result.ok).toBe(true);
    expect(path).toBe(`/contoso/${PROJECT_ID}/_apis/git/repositories/${REPO_ID}/pullrequests/${PR_ID}`);
  });
});

describe('getPullRequestChecks', () => {
  it('counts artboard 6 "PR open" as 3 / 4 checks: "PR !10612 · 3 / 4 checks"', async () => {
    const { seen, record } = recorder();
    server.use(...checkHandlers(artboardPolicyEvaluations, () => [], record));
    const { client } = createTestClient();

    const result = await getPullRequestChecks(client, EXPECTED_PR);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(PullRequestChecksSchema.parse(result.data)).toEqual(result.data);
    expect(result.data).toMatchObject({ passed: 3, total: 4, pending: 1, failing: [] });
    expect(result.data.checks.map(({ name, state, required }) => ({ name, state, required }))).toEqual([
      { name: 'OnSite CI', state: 'passed', required: true },
      { name: 'Minimum number of reviewers', state: 'pending', required: true },
      { name: 'Work item linking', state: 'passed', required: true },
      { name: 'Comment requirements', state: 'passed', required: false },
    ]);
    expect(result.data.checks[0]?.url).toBe(`${ORG_URL}/Onsite%20Companion/_build/results?buildId=4512`);
    expect(formatPullRequestActivity(EXPECTED_PR, result.data)).toBe('PR !10612 · 3 / 4 checks');

    const evaluations = seen.find((request) => request.url.pathname.endsWith('/_apis/policy/evaluations'));
    expect(evaluations?.url.pathname).toBe(`/contoso/${PROJECT_ID}/_apis/policy/evaluations`);
    expect(evaluations?.url.searchParams.get('artifactId')).toBe(`vstfs:///CodeReview/CodeReviewId/${PROJECT_ID}/${PR_ID}`);
    expect(evaluations?.url.searchParams.get('api-version')).toBe('7.1-preview.1');
    const statuses = seen.find((request) => request.url.pathname.endsWith('/statuses'));
    expect(statuses?.url.pathname).toBe(`/contoso/${PROJECT_ID}/_apis/git/repositories/${REPO_ID}/pullRequests/${PR_ID}/statuses`);
    expect(statuses?.url.searchParams.get('api-version')).toBe('7.1-preview.1');
  });

  it('lists a failed build in failing[] with its first error and results link', async () => {
    server.use(
      ...checkHandlers(() => [
        policyEvaluation(BUILD_POLICY_TYPE, 'rejected', {
          settings: { displayName: 'OnSite CI' },
          context: { buildId: 4513, buildOutputPreview: { jobName: 'Build', errors: [{ message: 'CS0246: JobFilterState not found' }, { message: 'CS0103' }] } },
        }),
        policyEvaluation(REVIEWERS_POLICY_TYPE, 'approved'),
        policyEvaluation(WORK_ITEM_LINKING_POLICY_TYPE, 'broken'),
      ]),
    );
    const { client } = createTestClient();

    const result = await getPullRequestChecks(client, EXPECTED_PR);

    expect(result.ok && result.data).toMatchObject({ passed: 1, total: 3, pending: 0 });
    expect(result.ok && result.data.failing).toEqual([
      expect.objectContaining({
        kind: 'policy',
        name: 'OnSite CI',
        state: 'failed',
        detail: 'CS0246: JobFilterState not found',
        url: `${ORG_URL}/Onsite%20Companion/_build/results?buildId=4513`,
      }),
      expect.objectContaining({ name: 'Work item linking', state: 'failed', detail: null, url: null }),
    ]);
  });

  it('ignores not-applicable, disabled and deleted policies', async () => {
    server.use(
      ...checkHandlers(() => [
        policyEvaluation(BUILD_POLICY_TYPE, 'notApplicable'),
        policyEvaluation(BUILD_POLICY_TYPE, 'rejected', { isEnabled: false }),
        policyEvaluation(BUILD_POLICY_TYPE, 'rejected', { isDeleted: true }),
      ]),
    );
    const { client } = createTestClient();

    const result = await getPullRequestChecks(client, EXPECTED_PR);

    expect(result).toEqual({ ok: true, data: { passed: 0, total: 0, pending: 0, failing: [], checks: [] } });
    expect(result.ok && formatPullRequestActivity(EXPECTED_PR, result.data)).toBe('PR !10612 · no checks');
  });

  it('counts the latest status per context, after the policies, as optional', async () => {
    server.use(
      ...checkHandlers(
        () => [policyEvaluation(REVIEWERS_POLICY_TYPE, 'approved', { isBlocking: false }), policyEvaluation(BUILD_POLICY_TYPE, 'queued', { isBlocking: true })],
        () => [
          pullRequestStatus('sonarcloud', 'quality-gate', 'failed', { id: 1, iterationId: 1 }),
          pullRequestStatus('sonarcloud', 'quality-gate', 'succeeded', { id: 2, iterationId: 2, targetUrl: 'https://sonarcloud.io/dashboard?id=onsite', description: 'Quality gate passed' }),
          pullRequestStatus('security', 'scan', 'error', { id: 3, targetUrl: 'javascript:alert(1)' }),
          pullRequestStatus(null, 'lint', 'partiallySucceeded', { id: 4 }),
          pullRequestStatus('deploy', 'preview', 'pending', { id: 5 }),
          pullRequestStatus('deploy', 'docs', 'notSet', { id: 6 }),
          pullRequestStatus('deploy', 'skipped', 'notApplicable', { id: 7 }),
        ],
      ),
    );
    const { client } = createTestClient();

    const result = await getPullRequestChecks(client, EXPECTED_PR);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.checks.map(({ id, kind, name, state, required }) => ({ id, kind, name, state, required }))).toEqual([
      expect.objectContaining({ kind: 'policy', name: 'Build', state: 'pending', required: true }),
      expect.objectContaining({ kind: 'policy', name: 'Minimum number of reviewers', state: 'passed', required: false }),
      { id: 'status:sonarcloud/quality-gate', kind: 'status', name: 'sonarcloud/quality-gate', state: 'passed', required: false },
      { id: 'status:security/scan', kind: 'status', name: 'security/scan', state: 'failed', required: false },
      { id: 'status:lint', kind: 'status', name: 'lint', state: 'passed', required: false },
      { id: 'status:deploy/preview', kind: 'status', name: 'deploy/preview', state: 'pending', required: false },
      { id: 'status:deploy/docs', kind: 'status', name: 'deploy/docs', state: 'pending', required: false },
    ]);
    expect(result.data.checks[2]).toMatchObject({ detail: 'Quality gate passed', url: 'https://sonarcloud.io/dashboard?id=onsite' });
    expect(result.data.checks[3]?.url).toBeNull();
    expect(result.data).toMatchObject({ passed: 3, total: 7, pending: 3 });
    expect(result.data.failing.map((check) => check.name)).toEqual(['security/scan']);
  });

  it('counts a status that a status policy enforces once, as the policy', async () => {
    server.use(
      ...checkHandlers(
        () => [policyEvaluation(STATUS_POLICY_TYPE, 'rejected', { settings: { statusGenre: 'SonarCloud', statusName: 'Quality-Gate' } })],
        () => [pullRequestStatus('sonarcloud', 'quality-gate', 'failed', { description: 'Quality gate failed' })],
      ),
    );
    const { client } = createTestClient();

    const result = await getPullRequestChecks(client, EXPECTED_PR);

    expect(result.ok && result.data.checks).toEqual([expect.objectContaining({ kind: 'policy', name: 'SonarCloud/Quality-Gate', state: 'failed', required: true })]);
  });

  it('still counts a status whose status policy does not apply to this PR', async () => {
    server.use(
      ...checkHandlers(
        () => [policyEvaluation(STATUS_POLICY_TYPE, 'notApplicable', { settings: { statusGenre: 'sonarcloud', statusName: 'quality-gate' } })],
        () => [pullRequestStatus('sonarcloud', 'quality-gate', 'succeeded')],
      ),
    );
    const { client } = createTestClient();

    const result = await getPullRequestChecks(client, EXPECTED_PR);

    expect(result.ok && result.data.checks).toEqual([expect.objectContaining({ kind: 'status', name: 'sonarcloud/quality-gate', state: 'passed' })]);
  });

  it('names a policy by its display name, then its type', async () => {
    server.use(
      ...checkHandlers(() => [
        policyEvaluation(BUILD_POLICY_TYPE, 'approved', { settings: { displayName: null } }),
        policyEvaluation(COMMENTS_POLICY_TYPE, 'approved', { settings: { defaultDisplayName: 'Resolve comments' } }),
      ]),
    );
    const { client } = createTestClient();

    const result = await getPullRequestChecks(client, EXPECTED_PR);

    expect(result.ok && result.data.checks.map((check) => check.name)).toEqual(['Build', 'Resolve comments']);
  });

  it('fails the whole call when either list fails', async () => {
    server.use(
      http.get(`${ORG_URL}/:project/_apis/policy/evaluations`, () => HttpResponse.json({ count: 0, value: [] })),
      http.get(`${REPO_PATH}/pullRequests/:id/statuses`, () => new HttpResponse(null, { status: 403 })),
    );
    const { client } = createTestClient();

    expect(await getPullRequestChecks(client, EXPECTED_PR)).toMatchObject({ ok: false, code: 'ADO_SCOPE_MISSING' });
  });
});

describe('getPullRequestSnapshot', () => {
  it('follows a PR from open with 3 / 4 checks to completed, which moves the ticket to Done', async () => {
    let status = 'active';
    server.use(
      ...prHandlers(async () => {}, () => gitPullRequest(status === 'active' ? {} : { status, closedDate: '2026-10-07T05:20:00Z' })),
      ...checkHandlers(() =>
        status === 'active'
          ? artboardPolicyEvaluations()
          : [policyEvaluation(BUILD_POLICY_TYPE, 'approved'), policyEvaluation(REVIEWERS_POLICY_TYPE, 'approved')],
      ),
    );
    const { client } = createTestClient();

    const created = await createPullRequest(client, CREATE_INPUT);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const ref = pullRequestRef(created.data.pullRequest);

    const open = await getPullRequestSnapshot(client, ref);
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    expect(PullRequestSnapshotSchema.parse(open.data)).toEqual(open.data);
    expect(formatPullRequestActivity(open.data.pullRequest, open.data.checks)).toBe('PR !10612 · 3 / 4 checks');
    expect(isPullRequestClosed(open.data.pullRequest)).toBe(false);

    status = 'completed';
    const done = await getPullRequestSnapshot(client, ref);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(isPullRequestClosed(done.data.pullRequest)).toBe(true);
    expect(pullRequestOutcome(done.data.pullRequest)).toBe('merged');
    expect(done.data.pullRequest.closedAt).toBe('2026-10-07T05:20:00.000Z');
    expect(formatPullRequestActivity(done.data.pullRequest, done.data.checks)).toBe('PR !10612 · merged');
  });

  it('does not read checks when the PR cannot be read', async () => {
    const { seen, record } = recorder();
    server.use(http.get(`${REPO_PATH}/pullrequests/:id`, () => new HttpResponse(null, { status: 401 })), ...checkHandlers(() => [], () => [], record));
    const { client } = createTestClient();

    expect(await getPullRequestSnapshot(client, REF)).toMatchObject({ ok: false, code: 'ADO_UNAUTHORIZED' });
    expect(seen).toHaveLength(0);
  });
});

describe('linkWorkItemsToPullRequest', () => {
  it('links only the work items not linked yet, once each, and keeps ids sorted', async () => {
    const patched: number[] = [];
    server.use(
      http.patch(`${ORG_URL}/_apis/wit/workitems/:id`, ({ params }) => {
        patched.push(Number(params['id']));
        return HttpResponse.json({ id: Number(params['id']) });
      }),
    );
    const { client } = createTestClient();

    const result = await linkWorkItemsToPullRequest(client, { ...EXPECTED_PR, workItemIds: [71330] }, [71341, 71330, 71273, 71341]);

    expect(patched).toEqual([71341, 71273]);
    expect(result.ok && result.data.workItemIds).toEqual([71273, 71330, 71341]);
  });

  it('makes no request when every work item is already linked', async () => {
    const { client } = createTestClient();
    const result = await linkWorkItemsToPullRequest(client, EXPECTED_PR, [WORK_ITEM_ID]);
    expect(result).toEqual({ ok: true, data: EXPECTED_PR });
  });
});
