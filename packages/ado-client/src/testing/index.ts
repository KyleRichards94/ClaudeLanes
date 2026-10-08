/**
 * `@agent-lanes/ado-client/testing` (AL-065): the shared fake Azure DevOps organisation, as an MSW
 * handler set plus a `fetch` that runs it without a server. Unit tests (ado-client), main-process
 * tests (AdoService and the `ado:*` handlers) and the e2e loopback server all use it; the DTOs it
 * serves are in `@agent-lanes/contracts/testing`. Test-only: the app never imports this entry, and
 * nothing here needs Vitest.
 */
export {
  ADO_FIXTURE_PAT,
  adoAuthorization,
  createFakeAdoOrg,
  type FakeAdoOrg,
  type FakeAdoOrgOptions,
  type FakeAdoOrgState,
  type FakeAdoRequest,
} from './fake-org';
export { agileStates, type FakeAdo, type FakeWorkItem } from './fake-work-items';
export {
  artboard08Items,
  artboard08PullRequests,
  branchLink,
  createFakeTeamOrg,
  FAKE_TEAM_ORG_URL,
  FAKE_TEAM_PAT,
  FAKE_TEAM_PROJECT,
  FAKE_TEAM_PROJECT_ID,
  FAKE_TEAM_REPOSITORY,
  MOBILE_REPOSITORY,
  OSC_AREA,
  OSC_DEVELOPERS,
  OUTSIDER,
  PEOPLE,
  PROJECT_DEFAULT_TEAM,
  pullRequestLink,
  RELEASE_TRAIN,
  type FakeTeamOrg,
  type FakeTeamPullRequest,
  type FakeThread,
  type FakeTeamOrgOptions,
  type FakeTeamOrgState,
} from './fake-team';
