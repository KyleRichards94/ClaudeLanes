import { describe, expect, it } from 'vitest';
import {
  CreatePullRequestInputSchema,
  CreatedPullRequestSchema,
  formatPullRequestActivity,
  formatPullRequestChecks,
  isPullRequestClosed,
  PULL_REQUEST_DESCRIPTION_MAX,
  PullRequestBranchSchema,
  PullRequestChecksSchema,
  PullRequestSchema,
  pullRequestOutcome,
  pullRequestRef,
  summarizeChecks,
  type PullRequest,
  type PullRequestCheck,
} from './ado.pull-requests';

const PR: PullRequest = {
  id: 10612,
  title: 'Cutover frmJobControl to Blazor',
  description: '',
  status: 'active',
  mergeStatus: 'succeeded',
  isDraft: false,
  sourceBranch: '71273-cutover-job-control',
  targetBranch: 'main',
  repository: { id: 'repo-guid', name: 'OnSite', projectId: 'project-guid', projectName: 'Onsite Companion' },
  createdAt: '2026-10-07T04:12:31.441Z',
  closedAt: null,
  mergeCommitId: null,
  workItemIds: [71273],
  webUrl: 'https://dev.azure.com/contoso/Onsite%20Companion/_git/OnSite/pullrequest/10612',
};

function check(id: string, state: PullRequestCheck['state'], required = true): PullRequestCheck {
  return { id, kind: 'policy', name: id, state, required, detail: null, url: null };
}

describe('pull request contract', () => {
  it('accepts the artboard PR', () => {
    expect(PullRequestSchema.parse(PR)).toEqual(PR);
    expect(CreatedPullRequestSchema.parse({ pullRequest: PR, created: true }).created).toBe(true);
  });

  it('only allows http(s) web URLs, so the renderer can open them externally', () => {
    expect(PullRequestSchema.safeParse({ ...PR, webUrl: 'javascript:alert(1)' }).success).toBe(false);
  });

  it('keeps pull request ids positive 32-bit integers', () => {
    expect(PullRequestSchema.safeParse({ ...PR, id: 0 }).success).toBe(false);
    expect(PullRequestSchema.safeParse({ ...PR, id: 2_147_483_648 }).success).toBe(false);
  });

  it('refers to a PR by project and repository ids', () => {
    expect(pullRequestRef(PR)).toEqual({ project: 'project-guid', repository: 'repo-guid', pullRequestId: 10612 });
  });
});

describe('PullRequestBranchSchema', () => {
  it.each([
    ['71273-cutover-job-control', '71273-cutover-job-control'],
    ['refs/heads/71273-cutover-job-control', '71273-cutover-job-control'],
    ['  sub/71273-grid  ', 'sub/71273-grid'],
    ['nt-20261007-fix', 'nt-20261007-fix'],
  ])('accepts %s', (input, expected) => {
    expect(PullRequestBranchSchema.parse(input)).toBe(expected);
  });

  it.each(['', 'refs/heads/', 'a b', 'a..b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[b', 'a\\b', '-a', '/a', 'a/', 'a//b', 'a.', 'a.lock', 'a/.b', '@', 'a@{1}', 'tab\there', 'a\u0001b', 'a\u007fb'])(
    'refuses %j',
    (input) => {
      expect(PullRequestBranchSchema.safeParse(input).success).toBe(false);
    },
  );
});

describe('CreatePullRequestInputSchema', () => {
  const input = { project: 'Onsite Companion', repository: 'OnSite', sourceBranch: '71273-x', targetBranch: 'main', title: 'Cutover' };

  it('accepts the minimum and leaves optional fields unset', () => {
    expect(CreatePullRequestInputSchema.parse(input)).toEqual(input);
  });

  it('refuses the same branch on both sides, even when one is spelled as a ref', () => {
    const result = CreatePullRequestInputSchema.safeParse({ ...input, sourceBranch: 'refs/heads/main' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['targetBranch']);
  });

  it('caps the description at ADO’s limit', () => {
    expect(CreatePullRequestInputSchema.safeParse({ ...input, description: 'x'.repeat(PULL_REQUEST_DESCRIPTION_MAX) }).success).toBe(true);
    expect(CreatePullRequestInputSchema.safeParse({ ...input, description: 'x'.repeat(PULL_REQUEST_DESCRIPTION_MAX + 1) }).success).toBe(false);
  });
});

describe('checks', () => {
  it('summarises { passed, total, failing[] } with pending, counting optional checks too', () => {
    const checks = [check('build', 'passed'), check('reviewers', 'pending'), check('linking', 'passed'), check('comments', 'passed', false), check('sonar', 'failed', false)];
    const summary = summarizeChecks(checks);
    expect(summary).toMatchObject({ passed: 3, total: 5, pending: 1 });
    expect(summary.failing.map((c) => c.id)).toEqual(['sonar']);
    expect(PullRequestChecksSchema.parse(summary)).toEqual(summary);
  });

  it('refuses counts that do not match the list', () => {
    const summary = summarizeChecks([check('build', 'passed'), check('tests', 'failed')]);
    expect(PullRequestChecksSchema.safeParse({ ...summary, passed: 2 }).success).toBe(false);
    expect(PullRequestChecksSchema.safeParse({ ...summary, failing: [] }).success).toBe(false);
  });

  it.each([
    [3, 4, '3 / 4 checks'],
    [1, 1, '1 / 1 check'],
    [0, 2, '0 / 2 checks'],
    [0, 0, 'no checks'],
  ])('%i of %i reads "%s"', (passed, total, text) => {
    expect(formatPullRequestChecks({ passed, total })).toBe(text);
  });
});

describe('card text and Done detection', () => {
  it('reads "PR !10612 · 3 / 4 checks" on the PR open card (artboard 6)', () => {
    expect(formatPullRequestActivity(PR, { passed: 3, total: 4 })).toBe('PR !10612 · 3 / 4 checks');
  });

  it('shows just the PR number while the checks are unknown', () => {
    expect(formatPullRequestActivity(PR)).toBe('PR !10612');
    expect(formatPullRequestActivity(PR, null)).toBe('PR !10612');
  });

  it('marks a completed PR as merged and an abandoned one as abandoned; both are closed (→ Done)', () => {
    expect(pullRequestOutcome(PR)).toBe('open');
    expect(isPullRequestClosed(PR)).toBe(false);

    expect(pullRequestOutcome({ status: 'completed' })).toBe('merged');
    expect(isPullRequestClosed({ status: 'completed' })).toBe(true);
    expect(formatPullRequestActivity({ id: 10612, status: 'completed' }, { passed: 4, total: 4 })).toBe('PR !10612 · merged');

    expect(pullRequestOutcome({ status: 'abandoned' })).toBe('abandoned');
    expect(isPullRequestClosed({ status: 'abandoned' })).toBe(true);
    expect(formatPullRequestActivity({ id: 10612, status: 'abandoned' })).toBe('PR !10612 · abandoned');
  });
});
