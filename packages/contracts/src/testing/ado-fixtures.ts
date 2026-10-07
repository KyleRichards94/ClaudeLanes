import type { PullRequestCheck, PullRequestSnapshot } from '../domains/ado.pull-requests';
import { summarizeChecks } from '../domains/ado.pull-requests';
import type { Sprint, SprintList, WorkItem } from '../domains/ado.schemas';
import type { WorkItemComment } from '../domains/ado.write-back';

/**
 * The shared Azure DevOps fixture (AL-065): one organisation as the artboards show it. Sprint 42
 * (7 – 20 Oct, artboard 1) holds #71273, #71330, #71335 and #71341 (artboard 2); #71273 has a
 * discussion and PR !10612 with 3 of 4 checks passed (artboard 6 "PR open").
 *
 * These are the DTOs the `ado:*` channels return. `@agent-lanes/ado-client/testing` serves the same
 * data as Azure DevOps REST answers through MSW (`createFakeAdoOrg`), so a test can compare what a
 * channel returns with these values exactly; renderer tests answer the fake bridge with them.
 * Test-only: nothing in the app imports this entry.
 */

/** Never a real organisation: `contoso` is Microsoft's sample name. Every fixture URL is under it. */
export const ADO_FIXTURE_ORG_URL = 'https://dev.azure.com/contoso';
/** The connection id ConnectionsService gives that organisation (AL-042). */
export const ADO_FIXTURE_ORG_ID = 'ado:contoso';
/** Who the fixture PAT signs in as (artboard 5 "signed in as Kyle Richards"). */
export const ADO_FIXTURE_IDENTITY = 'Kyle Richards';

export const ADO_FIXTURE_PROJECT = 'OnSite Companion';
export const ADO_FIXTURE_PROJECT_ID = '6ce954b1-ce1f-45d1-b94d-e6bf2464ba2c';
export const ADO_FIXTURE_TEAM = 'OnSite Companion Team';
export const ADO_FIXTURE_TEAM_ID = '9a1c6c2e-3b4d-4e5f-8a6b-7c8d9e0f1a2b';
/** Artboard 2's Workspace table: repo `onsite-companion`, base `main`. */
export const ADO_FIXTURE_REPOSITORY = { id: '3411ebc1-d5aa-464f-9615-0b527bc66719', name: 'onsite-companion' } as const;
export const ADO_FIXTURE_BASE_BRANCH = 'main';

export const ADO_FIXTURE_SPRINT_42_ID = '00000000-0000-4000-8000-000000000042';
export const ADO_FIXTURE_SPRINT_42_PATH = `${ADO_FIXTURE_PROJECT}\\Sprint 42`;

/** The four work items on artboard 2, in Sprint 42. */
export const ADO_FIXTURE_SPRINT_42_ITEM_IDS = [71273, 71330, 71335, 71341] as const;
/** A story in Sprint 43, so a sprint's list visibly leaves it out. */
export const ADO_FIXTURE_SPRINT_43_ITEM_ID = 71400;

/** PR !10612 from the ticket branch of #71273 (artboard 2's worktree name) into main. */
export const ADO_FIXTURE_PULL_REQUEST_ID = 10612;
export const ADO_FIXTURE_TICKET_BRANCH = '71273-cutover-frmjobcontrol-to';

export interface AdoFixture {
  orgUrl: string;
  sprints: SprintList;
  /** Every work item in the organisation, lowest id first. */
  workItems: WorkItem[];
  /** Each work item's discussion, oldest first. Items without one are left out. */
  comments: Record<number, WorkItemComment[]>;
  /** Every pull request with its checks, lowest id first. */
  pullRequests: PullRequestSnapshot[];
}

/**
 * A fresh copy of the fixture for `orgUrl` (default {@link ADO_FIXTURE_ORG_URL}); web URLs are built
 * under it the way the ado-client builds them, so e2e can serve the same data from a loopback port.
 */
export function adoFixture(orgUrl: string = ADO_FIXTURE_ORG_URL): AdoFixture {
  return {
    orgUrl,
    sprints: fixtureSprints(),
    workItems: fixtureWorkItems(orgUrl),
    comments: { 71273: fixtureComments() },
    pullRequests: [fixturePullRequest(orgUrl)],
  };
}

/** The work item with this id from {@link adoFixture}; throws for an id it doesn't have. */
export function adoFixtureWorkItem(id: number, orgUrl: string = ADO_FIXTURE_ORG_URL): WorkItem {
  const item = fixtureWorkItems(orgUrl).find((candidate) => candidate.id === id);
  if (!item) throw new Error(`The ADO fixture has no work item #${id}`);
  return item;
}

/** The web URL ado-client builds for a work item. */
export function adoFixtureWorkItemUrl(orgUrl: string, project: string, id: number): string {
  return `${orgUrl}/${encodeURIComponent(project)}/_workitems/edit/${id}`;
}

/** The web URL ado-client builds for a pull request. */
export function adoFixturePullRequestUrl(orgUrl: string, project: string, repository: string, id: number): string {
  return `${orgUrl}/${encodeURIComponent(project)}/_git/${encodeURIComponent(repository)}/pullrequest/${id}`;
}

/** Build results, as ado-client links a build policy check. */
export function adoFixtureBuildUrl(orgUrl: string, project: string, buildId: number): string {
  return `${orgUrl}/${encodeURIComponent(project)}/_build/results?buildId=${buildId}`;
}

function sprint(n: number, start: string, finish: string, timeFrame: Sprint['timeFrame']): Sprint {
  return {
    id: `00000000-0000-4000-8000-0000000000${n}`,
    name: `Sprint ${n}`,
    path: `${ADO_FIXTURE_PROJECT}\\Sprint ${n}`,
    start,
    finish,
    timeFrame,
  };
}

/** Two-week sprints; Sprint 42 (7 – 20 Oct 2026) is current. */
function fixtureSprints(): SprintList {
  return {
    sprints: [
      sprint(40, '2026-09-09', '2026-09-22', 'past'),
      sprint(41, '2026-09-23', '2026-10-06', 'past'),
      sprint(42, '2026-10-07', '2026-10-20', 'current'),
      sprint(43, '2026-10-21', '2026-11-03', 'future'),
      sprint(44, '2026-11-04', '2026-11-17', 'future'),
    ],
    currentId: ADO_FIXTURE_SPRINT_42_ID,
  };
}

function fixtureWorkItems(orgUrl: string): WorkItem[] {
  const item = (fields: Omit<WorkItem, 'project' | 'webUrl' | 'iterationPath' | 'assignedTo' | 'description' | 'acceptanceCriteria'> & Partial<WorkItem>): WorkItem => ({
    project: ADO_FIXTURE_PROJECT,
    iterationPath: ADO_FIXTURE_SPRINT_42_PATH,
    assignedTo: null,
    description: null,
    acceptanceCriteria: null,
    webUrl: adoFixtureWorkItemUrl(orgUrl, ADO_FIXTURE_PROJECT, fields.id),
    ...fields,
  });
  return [
    item({
      id: 71273,
      type: 'User Story',
      title: 'Cutover frmJobControl to Blazor',
      state: 'Active',
      stateCategory: 'in-progress',
      assignedTo: { displayName: ADO_FIXTURE_IDENTITY, uniqueName: 'kyle.richards@example.com' },
      description: '<div>Cut frmJobControl over to Blazor. Keep the WinForms child modals invoked via IWinFormsInvoker.</div>',
      acceptanceCriteria: '<ul><li>Grid filters work as in WinForms.</li><li>bUnit tests cover the grid filters.</li></ul>',
    }),
    item({
      id: 71330,
      type: 'Bug',
      title: 'Asset register paging slow above 5k rows',
      state: 'New',
      stateCategory: 'proposed',
      description: '<div>Paging the asset register takes several seconds once it holds more than 5,000 rows.</div>',
    }),
    item({ id: 71335, type: 'User Story', title: 'Client portal: show defect photos inline', state: 'New', stateCategory: 'proposed' }),
    item({ id: 71341, type: 'Bug', title: 'Roster view ignores public holidays', state: 'New', stateCategory: 'proposed' }),
    item({
      id: ADO_FIXTURE_SPRINT_43_ITEM_ID,
      type: 'User Story',
      title: 'Job costing tab',
      state: 'New',
      stateCategory: 'proposed',
      iterationPath: `${ADO_FIXTURE_PROJECT}\\Sprint 43`,
    }),
  ];
}

function fixtureComments(): WorkItemComment[] {
  return [
    {
      id: 1,
      workItemId: 71273,
      text: '<div>Scope agreed: keep the WinForms child modals for now.</div>',
      format: 'html',
      author: ADO_FIXTURE_IDENTITY,
      createdAt: '2026-10-07T00:15:00.000Z',
      updatedAt: null,
      fromAgentLanes: false,
    },
    {
      id: 2,
      workItemId: 71273,
      text: 'Agent Lanes · Planning — plan approved by Kyle',
      format: 'html',
      author: ADO_FIXTURE_IDENTITY,
      createdAt: '2026-10-07T01:02:00.000Z',
      updatedAt: null,
      fromAgentLanes: true,
    },
  ];
}

function fixturePullRequest(orgUrl: string): PullRequestSnapshot {
  const { id: repositoryId, name: repositoryName } = ADO_FIXTURE_REPOSITORY;
  const policy = (n: number, name: string, state: PullRequestCheck['state'], required: boolean, url: string | null = null): PullRequestCheck => ({
    id: `policy:a1f0c3e2-0000-4000-8000-00000000000${n}`,
    kind: 'policy',
    name,
    state,
    required,
    detail: null,
    url,
  });
  return {
    pullRequest: {
      id: ADO_FIXTURE_PULL_REQUEST_ID,
      title: 'Cutover frmJobControl to Blazor',
      description: 'Moves the job control screen to Blazor.\n\nAB#71273',
      status: 'active',
      mergeStatus: 'succeeded',
      isDraft: false,
      sourceBranch: ADO_FIXTURE_TICKET_BRANCH,
      targetBranch: ADO_FIXTURE_BASE_BRANCH,
      repository: { id: repositoryId, name: repositoryName, projectId: ADO_FIXTURE_PROJECT_ID, projectName: ADO_FIXTURE_PROJECT },
      createdAt: '2026-10-07T04:12:31.441Z',
      closedAt: null,
      mergeCommitId: 'b4f1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9',
      workItemIds: [71273],
      webUrl: adoFixturePullRequestUrl(orgUrl, ADO_FIXTURE_PROJECT, repositoryName, ADO_FIXTURE_PULL_REQUEST_ID),
    },
    // "PR !10612 · 3 / 4 checks": the build, linking and comment policies pass; a reviewer is still needed.
    checks: summarizeChecks([
      policy(1, 'OnSite CI', 'passed', true, adoFixtureBuildUrl(orgUrl, ADO_FIXTURE_PROJECT, 4512)),
      policy(2, 'Minimum number of reviewers', 'pending', true),
      policy(3, 'Work item linking', 'passed', true),
      policy(4, 'Comment requirements', 'passed', false),
    ]),
  };
}
