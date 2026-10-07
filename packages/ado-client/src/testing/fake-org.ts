import {
  isAgentLanesComment,
  summarizeChecks,
  type PullRequest,
  type PullRequestCheck,
  type PullRequestMergeStatus,
  type PullRequestSnapshot,
  type Sprint,
  type SprintList,
  type WorkItem,
  type WorkItemComment,
} from '@agent-lanes/contracts';
import {
  ADO_FIXTURE_IDENTITY,
  ADO_FIXTURE_ORG_URL,
  ADO_FIXTURE_PROJECT,
  ADO_FIXTURE_PROJECT_ID,
  ADO_FIXTURE_REPOSITORY,
  ADO_FIXTURE_TEAM,
  ADO_FIXTURE_TEAM_ID,
  adoFixture,
  type AdoFixture,
} from '@agent-lanes/contracts/testing';
import { getResponse, http, HttpResponse, type HttpHandler } from 'msw';
import type { FetchLike } from '../client';
import { createFakeWorkItems, fakeWorkItemHandlers, type FakeAdo, type FakeWorkItem } from './fake-work-items';
import { BUILD_POLICY_TYPE } from './pull-request-fixtures';

/**
 * The shared fake Azure DevOps organisation (AL-065): MSW handlers for every REST call the app makes
 * (connection data, teams, sprints, WIQL, work items and their states, comments, state changes, pull
 * requests, policy evaluations and statuses), answering from the DTO fixture in
 * `@agent-lanes/contracts/testing`. Reading it back through the ado-client gives exactly those DTOs.
 *
 * Use `handlers` with an MSW server, or `fetch` (a `FetchLike` that runs the same handlers without
 * one) with `createAdoClient`, the main process's AdoService, or the e2e loopback server. Requests
 * without the organisation's PAT get ADO's 401. State is mutable, so a test can move a work item,
 * fail a check or close the pull request, and writes (comments, state changes, new pull requests,
 * links) land in it.
 */

/** Made up; shaped like a real 52-character PAT and valid nowhere. The fake organisation accepts only this one. */
export const ADO_FIXTURE_PAT = 'fakepatAL065fixture0000only1111never2222real3333zz7Q';

/** The `Authorization` header ado-client sends for a PAT. */
export function adoAuthorization(pat: string): string {
  return `Basic ${btoa(`:${pat}`)}`;
}

export interface FakeAdoOrgOptions {
  /** Default {@link ADO_FIXTURE_ORG_URL}; e2e passes its loopback URL (`http://127.0.0.1:<port>/contoso`). */
  orgUrl?: string;
  /** The PAT the organisation accepts. Default {@link ADO_FIXTURE_PAT}. */
  pat?: string;
  /** The data to serve. Default `adoFixture(orgUrl)`. */
  fixture?: AdoFixture;
  /** Who the PAT signs in as. Default {@link ADO_FIXTURE_IDENTITY}. */
  identity?: string;
  /** Stamps new comments and pull requests. Default the real clock. */
  now?: () => Date;
}

export interface FakeAdoRequest {
  method: string;
  /** Path and query under the host, e.g. `/contoso/_apis/wit/workitemsbatch?api-version=7.1`. */
  path: string;
  /** Whether the request carried the organisation's PAT. */
  authorized: boolean;
}

export interface FakeAdoOrgState {
  sprints: SprintList;
  /** The work item store the WIQL fake (AL-062) queries; edit `items` to change what ADO holds. */
  workItems: FakeAdo;
  /** Each work item's revision, for state changes guarded by `test /rev`. */
  revisions: Map<number, number>;
  /** Each work item's discussion, oldest first. */
  comments: Map<number, WorkItemComment[]>;
  /** Pull requests and their checks; `webUrl` is ignored (ado-client builds its own). */
  pullRequests: PullRequestSnapshot[];
  /** Every request received, in order. */
  requests: FakeAdoRequest[];
  /** Requests no handler answered (`METHOD url`); they got a 501. */
  unhandled: string[];
}

export interface FakeAdoOrg {
  /** The organisation URL, without a trailing slash. */
  readonly orgUrl: string;
  readonly pat: string;
  /** The MSW handler set, for `setupServer(...handlers)` or `server.use(...handlers)`. */
  readonly handlers: HttpHandler[];
  /** Runs `handlers` for one request without an MSW server. Never throws; an unhandled request gets a 501. */
  readonly fetch: FetchLike;
  readonly state: FakeAdoOrgState;
}

/** Creates a fake organisation serving the AL-065 fixture (or `options.fixture`). */
export function createFakeAdoOrg(options: FakeAdoOrgOptions = {}): FakeAdoOrg {
  const orgUrl = (options.orgUrl ?? ADO_FIXTURE_ORG_URL).replace(/\/+$/, '');
  const pat = options.pat ?? ADO_FIXTURE_PAT;
  const identity = options.identity ?? ADO_FIXTURE_IDENTITY;
  const now = options.now ?? (() => new Date());
  const fixture = options.fixture ?? adoFixture(orgUrl);
  const authorization = adoAuthorization(pat);

  const state: FakeAdoOrgState = {
    sprints: structuredClone(fixture.sprints),
    workItems: createFakeWorkItems(fixture.workItems.map(toFakeWorkItem)),
    revisions: new Map(fixture.workItems.map((item) => [item.id, 1])),
    comments: new Map(Object.entries(structuredClone(fixture.comments)).map(([id, comments]) => [Number(id), comments])),
    pullRequests: structuredClone(fixture.pullRequests),
    requests: [],
    unhandled: [],
  };

  const findItem = (id: number) => state.workItems.items.find((item) => item.id === id);
  const findPullRequest = (repository: string, id: number) =>
    state.pullRequests.find(
      ({ pullRequest }) => pullRequest.id === id && (sameText(repository, pullRequest.repository.name) || sameText(repository, pullRequest.repository.id)),
    );
  const repo = `${orgUrl}/:project/_apis/git/repositories/:repository`;

  const handlers: HttpHandler[] = [
    // Every request is logged and must carry the PAT, as Azure DevOps answers 401 otherwise.
    http.all(`${orgUrl}/*`, ({ request }) => {
      const url = new URL(request.url);
      const authorized = request.headers.get('authorization') === authorization;
      state.requests.push({ method: request.method, path: `${url.pathname}${url.search}`, authorized });
      if (!authorized) return adoError(401, 'TF400813: The user is not authorized to access this resource.', 'UnauthorizedRequestException');
      return undefined;
    }),

    http.get(`${orgUrl}/_apis/connectionData`, () =>
      HttpResponse.json({
        authenticatedUser: { id: '6c3a2b1e-0000-4000-8000-000000000001', providerDisplayName: identity },
        authorizedUser: { id: '6c3a2b1e-0000-4000-8000-000000000001', providerDisplayName: identity },
      }),
    ),

    // ── Teams and sprints (AL-061) ──
    http.get(`${orgUrl}/_apis/projects/:project/teams`, ({ request, params }) => {
      if (!isProject(params['project'])) return projectNotFound(params['project']);
      const skip = Number(new URL(request.url).searchParams.get('$skip') ?? 0);
      const value = skip > 0 ? [] : [{ id: ADO_FIXTURE_TEAM_ID, name: ADO_FIXTURE_TEAM }];
      return HttpResponse.json({ count: value.length, value });
    }),
    http.get(`${orgUrl}/:project/:team/_apis/work/teamsettings/iterations`, ({ request, params }) => {
      if (!isProject(params['project'])) return projectNotFound(params['project']);
      if (!sameText(params['team'], ADO_FIXTURE_TEAM) && !sameText(params['team'], ADO_FIXTURE_TEAM_ID)) {
        return adoError(404, `VS800075: The team with id or name ${text(params['team'])} does not exist.`, 'TeamNotFoundException');
      }
      return iterations(request);
    }),
    http.get(`${orgUrl}/:project/_apis/work/teamsettings/iterations`, ({ request, params }) => {
      if (!isProject(params['project'])) return projectNotFound(params['project']);
      return iterations(request);
    }),

    // ── Work items: WIQL, batch reads, single reads and state categories (AL-062's fake) ──
    ...fakeWorkItemHandlers(state.workItems, orgUrl),

    // ── Comments (AL-063) ──
    http.get(`${orgUrl}/:project/_apis/wit/workItems/:id/comments`, ({ params }) => {
      const id = Number(params['id']);
      if (!isProject(params['project'])) return projectNotFound(params['project']);
      if (!findItem(id)) return workItemNotFound(id);
      const comments = (state.comments.get(id) ?? []).map(toAdoComment);
      return HttpResponse.json({ totalCount: comments.length, count: comments.length, comments });
    }),
    http.post(`${orgUrl}/:project/_apis/wit/workItems/:id/comments`, async ({ request, params }) => {
      const id = Number(params['id']);
      if (!isProject(params['project'])) return projectNotFound(params['project']);
      if (!findItem(id)) return workItemNotFound(id);
      const { text: body } = (await request.json()) as { text?: unknown };
      if (typeof body !== 'string' || body.trim() === '') return adoError(400, 'VS403591: The comment text cannot be empty.');
      const comment = addComment(id, body);
      return HttpResponse.json(toAdoComment(comment));
    }),

    // ── State changes (AL-063): read the state, then a JSON Patch guarded by `test /rev` ──
    http.get(`${orgUrl}/:project/_apis/wit/workitems/:id`, ({ params }) => {
      const id = Number(params['id']);
      const item = findItem(id);
      if (!isProject(params['project'])) return projectNotFound(params['project']);
      if (!item) return workItemNotFound(id);
      return HttpResponse.json({ id, rev: revision(id), fields: { 'System.State': item.state } });
    }),
    http.patch(`${orgUrl}/:project/_apis/wit/workitems/:id`, async ({ request, params }) => {
      const id = Number(params['id']);
      const item = findItem(id);
      if (!isProject(params['project'])) return projectNotFound(params['project']);
      if (!item) return workItemNotFound(id);
      const operations = (await request.json()) as Array<{ op: string; path: string; value: unknown }>;
      for (const operation of operations) {
        if (operation.op === 'test' && operation.path === '/rev' && operation.value !== revision(id)) {
          return adoError(412, 'TF26071: This work item has been changed by someone else since you opened it.');
        }
      }
      let history: string | undefined;
      for (const operation of operations) {
        if (operation.op !== 'add') continue;
        if (operation.path === '/fields/System.State') {
          const wanted = String(operation.value);
          const allowed = state.workItems.states[item.type]?.find((candidate) => sameText(candidate.name, wanted));
          if (!allowed) return adoError(400, `TF401320: Rule Error for field State. Error code: InvalidListValue. '${wanted}' is not a state of ${item.type}.`);
          item.state = allowed.name;
        } else if (operation.path === '/fields/System.History') {
          history = String(operation.value);
        }
      }
      state.revisions.set(id, revision(id) + 1);
      // ADO shows a history entry in the work item's discussion.
      if (history) addComment(id, history);
      return HttpResponse.json({ id, rev: revision(id), fields: { 'System.State': item.state } });
    }),

    // ── Pull requests (AL-064) ──
    http.post(`${repo}/pullrequests`, async ({ request, params }) => {
      if (!isProject(params['project'])) return projectNotFound(params['project']);
      if (!isRepository(params['repository'])) return repositoryNotFound(params['repository']);
      const body = (await request.json()) as {
        sourceRefName: string;
        targetRefName: string;
        title?: string;
        description?: string;
        isDraft?: boolean;
        workItemRefs?: Array<{ id: string | number }>;
      };
      const sourceBranch = fromRef(body.sourceRefName);
      const targetBranch = fromRef(body.targetRefName);
      const duplicate = state.pullRequests.find(
        ({ pullRequest }) => pullRequest.status === 'active' && pullRequest.sourceBranch === sourceBranch && pullRequest.targetBranch === targetBranch,
      );
      if (duplicate) {
        return adoError(409, 'TF401179: An active pull request for the source and target branch already exists.', 'GitPullRequestExistsException');
      }
      const id = Math.max(0, ...state.pullRequests.map(({ pullRequest }) => pullRequest.id)) + 1;
      const workItemIds = [...new Set((body.workItemRefs ?? []).map((ref) => Number(ref.id)))].filter((itemId) => findItem(itemId)).toSorted((a, b) => a - b);
      const pullRequest: PullRequest = {
        id,
        title: body.title ?? '',
        description: body.description ?? '',
        status: 'active',
        mergeStatus: 'queued',
        isDraft: body.isDraft ?? false,
        sourceBranch,
        targetBranch,
        repository: { id: ADO_FIXTURE_REPOSITORY.id, name: ADO_FIXTURE_REPOSITORY.name, projectId: ADO_FIXTURE_PROJECT_ID, projectName: ADO_FIXTURE_PROJECT },
        createdAt: now().toISOString(),
        closedAt: null,
        mergeCommitId: null,
        workItemIds,
        webUrl: `${orgUrl}/${encodeURIComponent(ADO_FIXTURE_PROJECT)}/_git/${encodeURIComponent(ADO_FIXTURE_REPOSITORY.name)}/pullrequest/${id}`,
      };
      // A new pull request waits for its build and a reviewer.
      const checks = summarizeChecks([newPolicyCheck(id, 1, 'OnSite CI'), newPolicyCheck(id, 2, 'Minimum number of reviewers')]);
      state.pullRequests.push({ pullRequest, checks });
      return HttpResponse.json(toGitPullRequest(pullRequest), { status: 201 });
    }),
    http.get(`${repo}/pullrequests`, ({ request, params }) => {
      if (!isProject(params['project'])) return projectNotFound(params['project']);
      if (!isRepository(params['repository'])) return repositoryNotFound(params['repository']);
      const query = new URL(request.url).searchParams;
      const source = query.get('searchCriteria.sourceRefName');
      const target = query.get('searchCriteria.targetRefName');
      const status = query.get('searchCriteria.status');
      const top = Number(query.get('$top') ?? 100);
      const value = state.pullRequests
        .map(({ pullRequest }) => pullRequest)
        .filter((pr) => (!source || `refs/heads/${pr.sourceBranch}` === source) && (!target || `refs/heads/${pr.targetBranch}` === target))
        .filter((pr) => !status || status === 'all' || pr.status === status)
        .slice(0, top)
        .map(toGitPullRequest);
      return HttpResponse.json({ count: value.length, value });
    }),
    http.get(`${repo}/pullrequests/:id`, ({ params }) => {
      if (!isProject(params['project'])) return projectNotFound(params['project']);
      const found = findPullRequest(text(params['repository']), Number(params['id']));
      if (!found) return pullRequestNotFound();
      return HttpResponse.json(toGitPullRequest(found.pullRequest));
    }),
    http.get(`${repo}/pullRequests/:id/statuses`, ({ params }) => {
      if (!isProject(params['project'])) return projectNotFound(params['project']);
      const found = findPullRequest(text(params['repository']), Number(params['id']));
      if (!found) return pullRequestNotFound();
      const value = found.checks.checks.filter((check) => check.kind === 'status').map(toAdoStatus);
      return HttpResponse.json({ count: value.length, value });
    }),
    http.get(`${orgUrl}/:project/_apis/policy/evaluations`, ({ request, params }) => {
      if (!isProject(params['project'])) return projectNotFound(params['project']);
      const artifact = /^vstfs:\/\/\/CodeReview\/CodeReviewId\/([^/]+)\/(\d+)$/.exec(new URL(request.url).searchParams.get('artifactId') ?? '');
      const found = artifact && sameText(artifact[1], ADO_FIXTURE_PROJECT_ID) ? state.pullRequests.find(({ pullRequest }) => pullRequest.id === Number(artifact[2])) : undefined;
      const value = (found?.checks.checks ?? []).filter((check) => check.kind === 'policy').map(toPolicyEvaluation);
      return HttpResponse.json({ count: value.length, value });
    }),

    // Linking a work item to a pull request: an ArtifactLink added on the work item (organisation level).
    http.patch(`${orgUrl}/_apis/wit/workitems/:id`, async ({ request, params }) => {
      const id = Number(params['id']);
      if (!findItem(id)) return workItemNotFound(id);
      const operations = (await request.json()) as Array<{ op: string; path: string; value?: { rel?: string; url?: string } }>;
      for (const operation of operations) {
        const link = /^vstfs:\/\/\/Git\/PullRequestId\/([^%]+)%2F([^%]+)%2F(\d+)$/i.exec(operation.value?.url ?? '');
        if (operation.op !== 'add' || operation.path !== '/relations/-' || operation.value?.rel !== 'ArtifactLink' || !link) continue;
        const target = state.pullRequests.find(({ pullRequest }) => pullRequest.id === Number(link[3]) && sameText(link[2], pullRequest.repository.id));
        if (!target) return adoError(400, `TF401350: The artifact link ${operation.value?.url ?? ''} is not valid.`);
        target.pullRequest.workItemIds = [...new Set([...target.pullRequest.workItemIds, id])].toSorted((a, b) => a - b);
      }
      state.revisions.set(id, revision(id) + 1);
      return HttpResponse.json({ id, rev: revision(id) });
    }),
  ];

  function iterations(request: Request) {
    const current = new URL(request.url).searchParams.get('$timeframe') === 'current';
    const sprints = current ? state.sprints.sprints.filter((sprint) => sprint.id === state.sprints.currentId) : state.sprints.sprints;
    const value = sprints.map((sprint) => toAdoIteration(orgUrl, sprint));
    return HttpResponse.json({ count: value.length, value });
  }

  function revision(id: number): number {
    return state.revisions.get(id) ?? 1;
  }

  function addComment(workItemId: number, text: string): WorkItemComment {
    const comments = state.comments.get(workItemId) ?? [];
    const comment: WorkItemComment = {
      id: Math.max(0, ...comments.map((existing) => existing.id)) + 1,
      workItemId,
      text,
      format: 'html',
      author: identity,
      createdAt: now().toISOString(),
      updatedAt: null,
      fromAgentLanes: isAgentLanesComment(text),
    };
    state.comments.set(workItemId, [...comments, comment]);
    return comment;
  }

  const fetch: FetchLike = async (input, init) => {
    try {
      const request = new Request(input, init);
      const response = await getResponse(handlers, request);
      if (response) return response;
      state.unhandled.push(`${request.method} ${request.url}`);
      return adoError(501, `The fake Azure DevOps organisation has no handler for ${request.method} ${new URL(request.url).pathname}.`);
    } catch (cause) {
      return adoError(500, `The fake Azure DevOps organisation failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  return { orgUrl, pat, handlers, fetch, state };
}

// ── DTO → Azure DevOps REST shapes ───────────────────────────────────────────

function toFakeWorkItem(item: WorkItem, index: number): FakeWorkItem {
  return {
    id: item.id,
    project: item.project,
    type: item.type,
    title: item.title,
    state: item.state,
    iterationPath: item.iterationPath,
    // Fixture order is most recently changed first, so title searches list them in that order.
    changedDate: new Date(Date.UTC(2026, 9, 7, 9) - index * 3_600_000).toISOString(),
    ...(item.assignedTo
      ? { assignedTo: item.assignedTo.uniqueName ? { displayName: item.assignedTo.displayName, uniqueName: item.assignedTo.uniqueName } : item.assignedTo.displayName }
      : {}),
    ...(item.description ? { description: item.description } : {}),
    ...(item.acceptanceCriteria ? { acceptanceCriteria: item.acceptanceCriteria } : {}),
  };
}

function toAdoIteration(orgUrl: string, sprint: Sprint) {
  return {
    id: sprint.id,
    name: sprint.name,
    path: sprint.path,
    attributes: {
      startDate: sprint.start && `${sprint.start}T00:00:00Z`,
      finishDate: sprint.finish && `${sprint.finish}T00:00:00Z`,
      timeFrame: sprint.timeFrame,
    },
    url: `${orgUrl}/${ADO_FIXTURE_PROJECT_ID}/${ADO_FIXTURE_TEAM_ID}/_apis/work/teamsettings/iterations/${sprint.id}`,
  };
}

function toAdoComment(comment: WorkItemComment) {
  return {
    id: comment.id,
    workItemId: comment.workItemId,
    version: 1,
    text: comment.text,
    format: comment.format,
    createdBy: { displayName: comment.author ?? '' },
    createdDate: comment.createdAt,
    // ADO sets modifiedDate to createdDate on a comment nobody has edited.
    modifiedDate: comment.updatedAt ?? comment.createdAt,
    isDeleted: false,
  };
}

const WIRE_MERGE_STATUS: Record<PullRequestMergeStatus, string> = {
  'not-set': 'notSet',
  queued: 'queued',
  conflicts: 'conflicts',
  succeeded: 'succeeded',
  'rejected-by-policy': 'rejectedByPolicy',
  failure: 'failure',
};

function toGitPullRequest(pr: PullRequest) {
  const { repository } = pr;
  return {
    pullRequestId: pr.id,
    codeReviewId: pr.id,
    status: pr.status,
    title: pr.title,
    description: pr.description,
    isDraft: pr.isDraft,
    mergeStatus: WIRE_MERGE_STATUS[pr.mergeStatus],
    sourceRefName: `refs/heads/${pr.sourceBranch}`,
    targetRefName: `refs/heads/${pr.targetBranch}`,
    creationDate: pr.createdAt,
    ...(pr.closedAt ? { closedDate: pr.closedAt } : {}),
    ...(pr.mergeCommitId ? { lastMergeCommit: { commitId: pr.mergeCommitId } } : {}),
    createdBy: { displayName: ADO_FIXTURE_IDENTITY },
    repository: {
      id: repository.id,
      name: repository.name,
      project: { id: repository.projectId, name: repository.projectName, state: 'wellFormed', visibility: 'private' },
    },
    workItemRefs: pr.workItemIds.map((id) => ({ id: String(id) })),
    supportsIterations: true,
  };
}

const POLICY_STATUS: Record<PullRequestCheck['state'], string> = { passed: 'approved', failed: 'rejected', pending: 'running' };
const STATUS_STATE: Record<PullRequestCheck['state'], string> = { passed: 'succeeded', failed: 'failed', pending: 'pending' };

/** A policy check as ADO's evaluation record; the build id comes back from the check's results URL. */
function toPolicyEvaluation(check: PullRequestCheck) {
  const buildId = check.url ? Number(new URL(check.url).searchParams.get('buildId')) || null : null;
  const context = {
    ...(buildId ? { buildId } : {}),
    ...(check.detail ? { buildOutputPreview: { errors: [{ message: check.detail }] } } : {}),
  };
  return {
    evaluationId: check.id.replace(/^policy:/, ''),
    status: POLICY_STATUS[check.state],
    configuration: {
      isEnabled: true,
      isBlocking: check.required,
      isDeleted: false,
      type: buildId ? BUILD_POLICY_TYPE : { id: '00000000-0000-4000-8000-0000000000ff', displayName: check.name },
      settings: { displayName: check.name },
    },
    ...(Object.keys(context).length > 0 ? { context } : {}),
  };
}

/** A status check as ADO's pull request status (`genre/name`). */
function toAdoStatus(check: PullRequestCheck, index: number) {
  const slash = check.name.indexOf('/');
  const context = slash > 0 ? { genre: check.name.slice(0, slash), name: check.name.slice(slash + 1) } : { name: check.name };
  return {
    id: index + 1,
    iterationId: 1,
    state: STATUS_STATE[check.state],
    ...(check.detail ? { description: check.detail } : {}),
    context,
    ...(check.url ? { targetUrl: check.url } : {}),
  };
}

function newPolicyCheck(pullRequestId: number, n: number, name: string): PullRequestCheck {
  return {
    id: `policy:c0ffee00-0000-4000-800${n}-${String(pullRequestId).padStart(12, '0')}`,
    kind: 'policy',
    name,
    state: 'pending',
    required: true,
    detail: null,
    url: null,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function adoError(status: number, message: string, typeKey?: string) {
  return HttpResponse.json({ $id: '1', innerException: null, message, ...(typeKey ? { typeKey } : {}), errorCode: 0, eventId: 3000 }, { status });
}

function projectNotFound(project: unknown) {
  return adoError(404, `TF200016: The following project does not exist: ${text(project)}.`, 'ProjectDoesNotExistWithNameException');
}

function repositoryNotFound(repository: unknown) {
  return adoError(404, `TF401019: The Git repository with name or identifier ${text(repository)} does not exist or you do not have permissions for the operation you are attempting.`, 'GitRepositoryNotFoundException');
}

function workItemNotFound(id: number) {
  return adoError(404, `TF401232: Work item ${id} does not exist, or you do not have permissions to read it.`, 'WorkItemUnauthorizedAccessException');
}

function pullRequestNotFound() {
  return adoError(404, 'TF401180: The requested pull request was not found.', 'GitPullRequestNotFoundException');
}

/** MSW hands over path parameters decoded; decode again defensively in case a caller double-encoded. */
function text(value: unknown): string {
  const raw = Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function sameText(a: unknown, b: unknown): boolean {
  return text(a).toLowerCase() === text(b).toLowerCase();
}

function isProject(value: unknown): boolean {
  return sameText(value, ADO_FIXTURE_PROJECT) || sameText(value, ADO_FIXTURE_PROJECT_ID);
}

function isRepository(value: unknown): boolean {
  return sameText(value, ADO_FIXTURE_REPOSITORY.name) || sameText(value, ADO_FIXTURE_REPOSITORY.id);
}

function fromRef(ref: string): string {
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
}

