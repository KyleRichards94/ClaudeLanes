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
export { normalizeOrgUrl } from './org-url';
export { adoPath } from './path';
export { DEFAULT_RETRY_POLICY, parseRetryAfter, type RetryPolicy } from './retry';
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
