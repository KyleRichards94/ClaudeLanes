import { getResponse, http, HttpResponse, type HttpHandler } from 'msw';
import type { FetchLike } from '../client';
import { createFakeWorkItems, FAKE_KANBAN_COLUMN_FIELD, FAKE_PROJECT, fakeWorkItemHandlers, SPRINT_42, SPRINT_43, type FakeAdo, type FakeWorkItem } from './fake-work-items';
import { adoAuthorization } from './fake-org';

/**
 * A fake Azure DevOps organisation for the team board (E14): the user's teams, the OSC Developers
 * board in Sprint 42 as on artboard 08 (AL-231). MSW handlers plus a `fetch` that runs them without a
 * server, like `createFakeAdoOrg`. Test-only.
 */

export const FAKE_TEAM_ORG_URL = 'https://dev.azure.com/CompanionSystems';
/** Made up; valid nowhere. */
export const FAKE_TEAM_PAT = 'fakepatE14teamboard0000only1111never2222real3333zz7Q';
export const FAKE_TEAM_PROJECT = FAKE_PROJECT;
export const FAKE_TEAM_PROJECT_ID = '6ce954b1-ce1f-45d1-b94d-e6bf2464ba2c';
export const OSC_DEVELOPERS = { id: '0f1e2d3c-4b5a-4968-8776-a5b4c3d2e1f0', name: 'OSC Developers' } as const;
export const RELEASE_TRAIN = { id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', name: 'Release Train' } as const;
export const PROJECT_DEFAULT_TEAM = { id: '9a1c6c2e-3b4d-4e5f-8a6b-7c8d9e0f1a2b', name: 'OnSite Companion Team' } as const;
export const OSC_AREA = `${FAKE_PROJECT}\\OSC`;
export const SPRINT_41 = `${FAKE_PROJECT}\\Sprint 41`;

/** The people on artboard 08. Kyle is the signed-in user. */
export const PEOPLE = {
  KR: { id: '6c3a2b1e-0000-4000-8000-000000000001', displayName: 'Kyle Richards', uniqueName: 'kyle.richards@example.com' },
  MD: { id: '6c3a2b1e-0000-4000-8000-000000000002', displayName: 'Mia Davies', uniqueName: 'mia.davies@example.com' },
  RJ: { id: '6c3a2b1e-0000-4000-8000-000000000003', displayName: 'Ravi Joshi', uniqueName: 'ravi.joshi@example.com' },
  TY: { id: '6c3a2b1e-0000-4000-8000-000000000004', displayName: 'Tom Young', uniqueName: 'tom.young@example.com' },
} as const;

/** The repository the board's branches and pull requests are in. */
export const FAKE_TEAM_REPOSITORY = { id: '3411ebc1-d5aa-464f-9615-0b527bc66719', name: 'onsite-companion' } as const;

export function pullRequestLink(id: number, repositoryId: string = FAKE_TEAM_REPOSITORY.id) {
  return { rel: 'ArtifactLink', url: `vstfs:///Git/PullRequestId/${FAKE_TEAM_PROJECT_ID}%2F${repositoryId}%2F${id}`, attributes: { name: 'Pull Request' } };
}

export function branchLink(branch: string, repositoryId: string = FAKE_TEAM_REPOSITORY.id) {
  return { rel: 'ArtifactLink', url: `vstfs:///Git/Ref/${FAKE_TEAM_PROJECT_ID}%2F${repositoryId}%2F${encodeURIComponent(`GB${branch}`)}`, attributes: { name: 'Branch' } };
}

/** The OSC Developers board's columns (Agile process), left to right. */
export function oscBoardColumns() {
  const mapping = (state: string) => ({ 'User Story': state, Bug: state });
  return [
    { id: 'c-todo', name: 'To Do', itemLimit: 0, columnType: 'incoming', isSplit: false, stateMappings: mapping('New') },
    { id: 'c-progress', name: 'In Progress', itemLimit: 5, columnType: 'inProgress', isSplit: false, stateMappings: mapping('Active') },
    { id: 'c-review', name: 'Code Review', itemLimit: 5, columnType: 'inProgress', isSplit: false, stateMappings: mapping('Active') },
    { id: 'c-testing', name: 'Testing', itemLimit: 5, columnType: 'inProgress', isSplit: false, stateMappings: mapping('Resolved') },
    { id: 'c-failed', name: 'Failed', itemLimit: 0, columnType: 'inProgress', isSplit: false, stateMappings: mapping('Active') },
    { id: 'c-done', name: 'Closed', itemLimit: 0, columnType: 'outgoing', isSplit: false, stateMappings: mapping('Closed') },
  ];
}

function boardItem(input: Omit<FakeWorkItem, 'project' | 'iterationPath' | 'changedDate' | 'areaPath'> & Partial<FakeWorkItem>): FakeWorkItem {
  return { project: FAKE_PROJECT, iterationPath: SPRINT_42, areaPath: OSC_AREA, changedDate: '2026-10-07T09:00:00Z', ...input };
}

/** The nine cards on artboard 08 (Sprint 42), plus items the board must leave out. */
export function artboard08Items(): FakeWorkItem[] {
  return [
    boardItem({ id: 71341, type: 'Bug', title: 'Roster view ignores public holidays', state: 'New', boardColumn: 'To Do', storyPoints: 3, assignedTo: PEOPLE.MD }),
    boardItem({ id: 71335, type: 'User Story', title: 'Client portal: show defect photos inline', state: 'New', boardColumn: 'To Do', storyPoints: 5 }),
    boardItem({
      id: 71273,
      type: 'User Story',
      title: 'Cutover frmJobControl to Blazor',
      state: 'Active',
      boardColumn: 'In Progress',
      storyPoints: 8,
      assignedTo: PEOPLE.KR,
      relations: [branchLink('71273-cutover-frmjobcontrol-to'), { rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'https://dev.azure.com/CompanionSystems/_apis/wit/workItems/70002' }],
    }),
    boardItem({ id: 71352, type: 'Bug', title: 'Timesheet approval email sends twice', state: 'Active', boardColumn: 'In Progress', storyPoints: 2, assignedTo: PEOPLE.RJ }),
    boardItem({
      id: 71298,
      type: 'User Story',
      title: 'Supplier invoice matching rules',
      state: 'Active',
      boardColumn: 'Code Review',
      storyPoints: 5,
      assignedTo: PEOPLE.TY,
      relations: [branchLink('users/ty/71298-invoice-matching'), pullRequestLink(10598)],
    }),
    boardItem({
      id: 71301,
      type: 'User Story',
      title: 'Defect request accept modal',
      state: 'Active',
      boardColumn: 'Code Review',
      storyPoints: 3,
      assignedTo: PEOPLE.KR,
      // An abandoned first PR and the live one: the newest wins.
      relations: [pullRequestLink(10560), branchLink('71301-defect-request-accept'), pullRequestLink(10604)],
    }),
    boardItem({ id: 71310, type: 'Bug', title: 'Timesheet export times out', state: 'Resolved', boardColumn: 'Testing', storyPoints: 3, assignedTo: PEOPLE.KR, relations: [branchLink('71310-timesheet-export')] }),
    boardItem({ id: 71287, type: 'User Story', title: 'Asset QR labels print at wrong size', state: 'Resolved', boardColumn: 'Testing', storyPoints: 2, assignedTo: PEOPLE.MD }),
    boardItem({ id: 71318, type: 'Bug', title: 'Quote PDF totals round incorrectly', state: 'Failed UAT', boardColumn: 'Failed', storyPoints: 2, assignedTo: PEOPLE.KR }),
    // Left out: done, a task, next sprint, and another team's area.
    boardItem({ id: 71250, type: 'User Story', title: 'Merged last week', state: 'Closed', boardColumn: 'Closed', storyPoints: 3, assignedTo: PEOPLE.KR }),
    boardItem({ id: 80010, type: 'Task', title: 'Write the migration script', state: 'Active', assignedTo: PEOPLE.KR }),
    boardItem({ id: 71400, type: 'User Story', title: 'Job costing tab', state: 'New', boardColumn: 'To Do', iterationPath: SPRINT_43 }),
    boardItem({ id: 71420, type: 'Bug', title: 'Support desk macro broken', state: 'New', boardColumn: 'To Do', areaPath: `${FAKE_PROJECT}\\Support` }),
  ];
}

export interface FakeTeamOrgState {
  workItems: FakeAdo;
  /** The board's columns; tests may rename or add one. */
  boardColumns: ReturnType<typeof oscBoardColumns>;
  /** Every request received, `METHOD path?query`. */
  requests: string[];
  unhandled: string[];
  /** api-versions refused as newer than `serverVersion`. */
  versionRefusals: string[];
}

export interface FakeTeamOrg {
  readonly orgUrl: string;
  readonly pat: string;
  readonly handlers: HttpHandler[];
  readonly fetch: FetchLike;
  readonly state: FakeTeamOrgState;
}

export interface FakeTeamOrgOptions {
  orgUrl?: string;
  items?: FakeWorkItem[];
  /** Acts as Azure DevOps Server whose newest REST version is this (`6.0`): newer requests get its 400. */
  serverVersion?: string;
}

const SPRINTS = [
  { id: 'it-41', name: 'Sprint 41', path: SPRINT_41, attributes: { startDate: '2026-09-23T00:00:00Z', finishDate: '2026-10-06T00:00:00Z', timeFrame: 'past' } },
  { id: 'it-42', name: 'Sprint 42', path: SPRINT_42, attributes: { startDate: '2026-10-07T00:00:00Z', finishDate: '2026-10-20T00:00:00Z', timeFrame: 'current' } },
  { id: 'it-43', name: 'Sprint 43', path: SPRINT_43, attributes: { startDate: '2026-10-21T00:00:00Z', finishDate: '2026-11-03T00:00:00Z', timeFrame: 'future' } },
];

/** Creates the fake organisation; `handlers` for an MSW server, or `fetch` for a client. */
export function createFakeTeamOrg(options: FakeTeamOrgOptions = {}): FakeTeamOrg {
  const orgUrl = (options.orgUrl ?? FAKE_TEAM_ORG_URL).replace(/\/+$/, '');
  const authorization = adoAuthorization(FAKE_TEAM_PAT);
  const state: FakeTeamOrgState = {
    workItems: createFakeWorkItems(options.items ?? artboard08Items()),
    boardColumns: oscBoardColumns(),
    requests: [],
    unhandled: [],
    versionRefusals: [],
  };

  const teams = [OSC_DEVELOPERS, RELEASE_TRAIN, PROJECT_DEFAULT_TEAM];
  const mine = [OSC_DEVELOPERS, RELEASE_TRAIN];
  const findTeam = (key: unknown) => teams.find((team) => sameText(key, team.id) || sameText(key, team.name));
  const team = `${orgUrl}/:project/:team/_apis/work`;

  const handlers: HttpHandler[] = [
    http.all(`${orgUrl}/*`, ({ request }) => {
      const url = new URL(request.url);
      state.requests.push(`${request.method} ${decodeURIComponent(url.pathname)}${url.search}`);
      if (request.headers.get('authorization') !== authorization) return adoError(401, 'TF400813: The user is not authorized to access this resource.');
      const version = url.searchParams.get('api-version') ?? '';
      if (options.serverVersion && Number.parseFloat(version) > Number.parseFloat(options.serverVersion)) {
        state.versionRefusals.push(version);
        return adoError(
          400,
          `The requested REST API version of ${version} is out of range for this server. The latest REST API version this server supports is ${options.serverVersion}.`,
        );
      }
      return undefined;
    }),

    http.get(`${orgUrl}/_apis/projects/:project/teams`, ({ request, params }) => {
      if (!isProject(params['project'])) return projectNotFound();
      const value = new URL(request.url).searchParams.get('$mine') === 'true' ? mine : teams;
      return HttpResponse.json({ count: value.length, value });
    }),
    http.get(`${orgUrl}/_apis/projects/:project/teams/:team`, ({ params }) => {
      if (!isProject(params['project'])) return projectNotFound();
      const found = findTeam(params['team']);
      return found ? HttpResponse.json(found) : teamNotFound(params['team']);
    }),
    http.get(`${orgUrl}/_apis/projects/:project`, ({ params }) => {
      if (!isProject(params['project'])) return projectNotFound();
      return HttpResponse.json({ id: FAKE_TEAM_PROJECT_ID, name: FAKE_TEAM_PROJECT, defaultTeam: PROJECT_DEFAULT_TEAM });
    }),

    http.get(`${team}/teamsettings/iterations`, ({ request, params }) => {
      if (!isProject(params['project'])) return projectNotFound();
      if (!findTeam(params['team'])) return teamNotFound(params['team']);
      const current = new URL(request.url).searchParams.get('$timeframe') === 'current';
      const value = current ? SPRINTS.filter((sprint) => sprint.attributes.timeFrame === 'current') : SPRINTS;
      return HttpResponse.json({ count: value.length, value });
    }),
    http.get(`${team}/teamsettings/teamfieldvalues`, ({ params }) => {
      if (!isProject(params['project'])) return projectNotFound();
      if (!findTeam(params['team'])) return teamNotFound(params['team']);
      return HttpResponse.json({
        field: { referenceName: 'System.AreaPath', url: `${orgUrl}/_apis/wit/fields/System.AreaPath` },
        defaultValue: OSC_AREA,
        values: [{ value: OSC_AREA, includeChildren: true }],
      });
    }),
    http.get(`${team}/backlogs`, ({ params }) => {
      if (!isProject(params['project'])) return projectNotFound();
      if (!findTeam(params['team'])) return teamNotFound(params['team']);
      return HttpResponse.json({
        count: 3,
        value: [
          { id: 'Microsoft.EpicCategory', name: 'Epics', rank: 3, type: 'portfolio' },
          { id: 'Microsoft.FeatureCategory', name: 'Features', rank: 2, type: 'portfolio' },
          { id: 'Microsoft.RequirementCategory', name: 'Stories', rank: 1, type: 'requirement' },
        ],
      });
    }),
    http.get(`${team}/boards/:board`, ({ params }) => {
      if (!isProject(params['project'])) return projectNotFound();
      if (!findTeam(params['team'])) return teamNotFound(params['team']);
      if (!sameText(params['board'], 'Stories')) return adoError(404, `VS800008: The board ${String(params['board'])} does not exist.`);
      return HttpResponse.json({
        id: 'b-stories',
        name: 'Stories',
        columns: state.boardColumns,
        fields: {
          columnField: { referenceName: FAKE_KANBAN_COLUMN_FIELD },
          rowField: { referenceName: 'WEF_6A3C1F_Kanban.Lane' },
          doneField: { referenceName: 'WEF_6A3C1F_Kanban.Column.Done' },
        },
      });
    }),

    ...fakeWorkItemHandlers(state.workItems, orgUrl),
  ];

  const fetch: FetchLike = async (input, init) => {
    try {
      const request = new Request(input, init);
      const response = await getResponse(handlers, request);
      if (response) return response;
      state.unhandled.push(`${request.method} ${request.url}`);
      return adoError(501, `The fake team organisation has no handler for ${request.method} ${new URL(request.url).pathname}.`);
    } catch (cause) {
      return adoError(500, `The fake team organisation failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  };

  return { orgUrl, pat: FAKE_TEAM_PAT, handlers, fetch, state };
}

function adoError(status: number, message: string) {
  return HttpResponse.json({ message, typeKey: 'FakeAdoException' }, { status });
}

function projectNotFound() {
  return adoError(404, 'TF200016: The following project does not exist.');
}

function teamNotFound(team: unknown) {
  return adoError(404, `VS800075: The team with id or name ${String(team)} does not exist.`);
}

function sameText(a: unknown, b: unknown): boolean {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

function isProject(value: unknown): boolean {
  return sameText(value, FAKE_TEAM_PROJECT) || sameText(value, FAKE_TEAM_PROJECT_ID);
}
