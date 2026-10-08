import { describe, expect, it } from 'vitest';
import { ADO_INVOKE_CHANNELS } from './ado.names';
import { invokeContracts } from '../schemas';
import { adoFixture, ADO_FIXTURE_ORG_ID, ADO_FIXTURE_PROJECT, ADO_FIXTURE_REPOSITORY, ADO_FIXTURE_SPRINT_42_PATH } from '../testing';

/** AL-065: every `ado:*` channel's request and response contract. */

const fixture = adoFixture();
const TEAM = { id: 'team-osc', name: 'OSC Developers' };

/** A request each channel accepts, and the fixture reply it answers with. */
const examples = {
  'ado:listSprints': { request: { org: ADO_FIXTURE_ORG_ID, project: ADO_FIXTURE_PROJECT, team: 'OnSite Companion Team' }, response: fixture.sprints },
  'ado:listWorkItems': { request: { iterationPath: ADO_FIXTURE_SPRINT_42_PATH }, response: fixture.workItems.slice(0, 4) },
  'ado:searchWorkItems': { request: { org: ADO_FIXTURE_ORG_ID, query: 'frmJobControl', top: 10 }, response: fixture.workItems.slice(0, 1) },
  'ado:getWorkItem': { request: { id: 71273 }, response: fixture.workItems[0] },
  'ado:getComments': { request: { project: ADO_FIXTURE_PROJECT, workItemId: 71273 }, response: fixture.comments[71273] },
  'ado:createPullRequest': {
    request: {
      org: ADO_FIXTURE_ORG_ID,
      project: ADO_FIXTURE_PROJECT,
      repository: ADO_FIXTURE_REPOSITORY.name,
      sourceBranch: '71330-asset-register-paging',
      targetBranch: 'main',
      title: 'Asset register paging',
      workItemIds: [71330],
    },
    response: { pullRequest: fixture.pullRequests[0]!.pullRequest, created: true },
  },
  'ado:getPullRequest': {
    request: { project: ADO_FIXTURE_PROJECT, repository: ADO_FIXTURE_REPOSITORY.id, pullRequestId: 10612 },
    response: fixture.pullRequests[0],
  },
  'ado:listTeams': { request: { project: ADO_FIXTURE_PROJECT }, response: { teams: [TEAM], defaultTeamId: TEAM.id } },
  'ado:teamBoard': {
    request: { team: 'OSC Developers', sprint: ADO_FIXTURE_SPRINT_42_PATH },
    response: {
      team: TEAM,
      sprint: { id: 'it-42', name: 'Sprint 42', path: ADO_FIXTURE_SPRINT_42_PATH },
      columns: [{ id: 'c-failed', name: 'Failed', kind: 'failed' }],
      items: [
        {
          id: 71318,
          type: 'Bug',
          title: 'Quote PDF totals round incorrectly',
          state: 'Failed UAT',
          points: 2,
          columnId: 'c-failed',
          column: 'Failed',
          columnKind: 'failed',
          assignee: { id: 'kr', displayName: 'Kyle Richards', uniqueName: null, initials: 'KR' },
          branch: null,
          pullRequestId: null,
          webUrl: 'https://dev.azure.com/contoso/OnSite%20Companion/_workitems/edit/71318',
        },
      ],
    },
  },
} as const satisfies Record<(typeof ADO_INVOKE_CHANNELS)[number], { request: unknown; response: unknown }>;

describe('ado:* channel contracts', () => {
  it('declares the channels from AL-065 and E14, each with a contract', () => {
    expect([...ADO_INVOKE_CHANNELS]).toEqual([
      'ado:listSprints',
      'ado:listWorkItems',
      'ado:searchWorkItems',
      'ado:getWorkItem',
      'ado:getComments',
      'ado:createPullRequest',
      'ado:getPullRequest',
      'ado:listTeams',
      'ado:teamBoard',
    ]);
    for (const channel of ADO_INVOKE_CHANNELS) expect(invokeContracts[channel]).toBeDefined();
  });

  it.each(ADO_INVOKE_CHANNELS)('%s accepts its example request and the fixture reply', (channel) => {
    const { request, response } = examples[channel];
    expect(invokeContracts[channel].request.safeParse(request).success).toBe(true);
    expect(invokeContracts[channel].response.parse(response)).toEqual(response);
  });

  it('lets org and project default: the smallest requests need only what identifies the data', () => {
    expect(invokeContracts['ado:listSprints'].request.parse({})).toEqual({});
    expect(invokeContracts['ado:getWorkItem'].request.parse({ id: 71273 })).toEqual({ id: 71273 });
    expect(invokeContracts['ado:searchWorkItems'].request.parse({ query: '  #71273 ' })).toEqual({ query: '#71273' });
  });

  it.each<[(typeof ADO_INVOKE_CHANNELS)[number], unknown, string]>([
    ['ado:listSprints', undefined, 'no request object'],
    ['ado:listSprints', { org: 'claude' }, 'a connection that is not ADO'],
    ['ado:listSprints', { org: 'ado:../secrets' }, 'a malformed organisation id'],
    ['ado:listSprints', { pat: 'fakepat' }, 'an undeclared field (a token has no place in a request)'],
    ['ado:listSprints', { project: '' }, 'an empty project'],
    ['ado:listSprints', { project: 'OnSite\nCompanion' }, 'a project with a control character'],
    ['ado:listWorkItems', {}, 'no iteration path'],
    ['ado:listWorkItems', { iterationPath: 'x'.repeat(1_025) }, 'an iteration path over 1,024 characters'],
    ['ado:searchWorkItems', { query: 'x'.repeat(257) }, 'a query over 256 characters'],
    ['ado:searchWorkItems', { query: 'job', top: 201 }, 'more than 200 results'],
    ['ado:searchWorkItems', { query: "x' OR 1=1\u0000" }, 'a query with a control character'],
    ['ado:getWorkItem', { id: 0 }, 'id 0'],
    ['ado:getWorkItem', { id: '71273' }, 'an id as a string'],
    ['ado:getComments', { workItemId: 2 ** 31 }, 'an id beyond 32 bits'],
    ['ado:getPullRequest', { project: 'p', repository: 'r', pullRequestId: 10612, extra: true }, 'an undeclared field'],
    ['ado:getPullRequest', { project: 'p', repository: 'r', pullRequestId: -1 }, 'a negative pull request id'],
  ])('%s refuses %j (%s)', (channel, request) => {
    expect(invokeContracts[channel].request.safeParse(request).success).toBe(false);
  });

  it('keeps the create-PR rules from AL-064: refs/heads/ dropped, source and target must differ, bounded title', () => {
    const contract = invokeContracts['ado:createPullRequest'].request;
    const base = examples['ado:createPullRequest'].request;
    expect(contract.parse({ ...base, sourceBranch: 'refs/heads/71330-asset-register-paging' })).toMatchObject({
      org: ADO_FIXTURE_ORG_ID,
      sourceBranch: '71330-asset-register-paging',
    });
    expect(contract.safeParse({ ...base, targetBranch: base.sourceBranch }).success).toBe(false);
    expect(contract.safeParse({ ...base, sourceBranch: 'bad branch name' }).success).toBe(false);
    expect(contract.safeParse({ ...base, title: '' }).success).toBe(false);
    expect(contract.safeParse({ ...base, org: 'mcp:github' }).success).toBe(false);
  });

  it('refuses replies that break the DTOs', () => {
    const item = fixture.workItems[0]!;
    expect(invokeContracts['ado:getWorkItem'].response.safeParse({ ...item, webUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(invokeContracts['ado:listSprints'].response.safeParse({ ...fixture.sprints, currentId: 'nope' }).success).toBe(false);
    const snapshot = fixture.pullRequests[0]!;
    expect(invokeContracts['ado:getPullRequest'].response.safeParse({ ...snapshot, checks: { ...snapshot.checks, passed: 4 } }).success).toBe(false);
  });
});
