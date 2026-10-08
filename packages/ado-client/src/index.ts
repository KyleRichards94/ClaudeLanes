/**
 * Typed Azure DevOps REST client (design §7). Core under AL-060; sprints, work items, write-back
 * and pull requests (AL-061–AL-064) build on `createAdoClient`. Runs only in the Electron main
 * process: it takes a PAT and must never be imported by the renderer.
 */
export { ADO_API_VERSION, DEFAULT_MAX_PAGES, DEFAULT_TIMEOUT_MS, REQUIRED_PAT_SCOPES } from './constants';
export {
  createAdoClient,
  type AdoCallOptions,
  type AdoClient,
  type AdoClientOptions,
  type AdoListOptions,
  type AdoLogEntry,
  type AdoRequest,
  type FetchLike,
  type HttpMethod,
  type QueryValue,
} from './client';
export { isAdoErrorDetails, type AdoErrorDetails, type AdoErrorKind } from './errors';
export { isInsecureOrgUrl, normalizeOrgUrl } from './org-url';
export { adoPath } from './path';
export { DEFAULT_RETRY_POLICY, parseRetryAfter, type RetryPolicy } from './retry';
export { listSprints, listTeams, TEAMS_PAGE_SIZE, type ListSprintsOptions, type SprintCallOptions, type TeamScope } from './sprints';
export { runWiql, WIQL_MAX_TOP, wiqlString, type RunWiqlOptions } from './wiql';
export {
  DEFAULT_SEARCH_TOP,
  DEFAULT_SPRINT_MAX_ITEMS,
  DEFAULT_WORK_ITEM_CATEGORIES,
  getWorkItem,
  getWorkItems,
  listSprintWorkItems,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_TOP_MAX,
  searchWorkItems,
  WORK_ITEM_FIELDS,
  WORK_ITEMS_BATCH_SIZE,
  type GetWorkItemOptions,
  type GetWorkItemsOptions,
  type ListSprintWorkItemsOptions,
  type SearchWorkItemsOptions,
} from './work-items';
export { parseAdoGitRemote, type AdoGitRemote } from './git-remote';
export {
  createPullRequest,
  findActivePullRequest,
  getPullRequest,
  getPullRequestChecks,
  getPullRequestSnapshot,
  linkWorkItemsToPullRequest,
  POLICY_EVALUATIONS_API_VERSION,
  PULL_REQUEST_STATUSES_API_VERSION,
  type PullRequestCallOptions,
} from './pull-requests';
export {
  addWorkItemComment,
  COMMENTS_API_VERSION,
  COMMENTS_PAGE_SIZE,
  listWorkItemComments,
  setWorkItemState,
  type SetWorkItemStateOptions,
  type WorkItemRef,
  type WriteBackCallOptions,
} from './write-back';
export {
  adoScopeOfRequest,
  CONNECTION_DATA_API_VERSION,
  getConnectionIdentity,
  listProjectNames,
  probeAdoScopes,
  PROJECTS_PAGE_SIZE,
  testAdoConnection,
  WORK_ITEMS_PROBE_QUERY,
  type AdoConnectionTest,
  type AdoConnectionTestOptions,
  type AdoIdentity,
  type ConnectionCallOptions,
  type ProbeAdoScopesOptions,
} from './connection-test';
export {
  BOARD_COLUMN_FIELD,
  boardColumnKind,
  getTeamBoard,
  gitLinksOf,
  listMyTeams,
  MY_TEAMS_PAGE_SIZE,
  resolveTeam,
  TEAM_BOARD_MAX_ITEMS,
  teamFieldClause,
  toPerson,
  type TeamBoardOptions,
  type TeamCallOptions,
} from './team-board';
export { adoColor, getWorkItemColors, type WorkItemColorsOptions } from './work-item-colors';
export {
  ACTIVE_PRS_PAGE_SIZE,
  isUnresolvedThread,
  listActivePullRequests,
  TEAM_MEMBERS_PAGE_SIZE,
  THREAD_READS_IN_PARALLEL,
  type ActivePullRequestsOptions,
  type PullRequestThread,
} from './active-prs';
export { BACKLOG_MAX_ITEMS, backlogQuery, getBacklog, groupByFeature, type BacklogOptions } from './backlog';
export {
  getSignedInUser,
  getWorkItemAssignment,
  inProgressStateOf,
  setWorkItemAssignment,
  type AdoPerson,
  type AssignmentCallOptions,
  type AssignmentChange,
  type AssignmentRef,
  type WorkItemAssignment,
} from './assignment';
export { listOpenThreads, type OpenThread } from './pr-threads';
