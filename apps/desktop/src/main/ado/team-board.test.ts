import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdoGitRemote } from '@agent-lanes/ado-client';
import { artboard11Backlog, createFakeTeamOrg, type FakeTeamOrgOptions, FAKE_TEAM_ORG_URL, FAKE_TEAM_PAT, FAKE_TEAM_PROJECT, OSC_DEVELOPERS, PEOPLE, RELEASE_TRAIN } from '@agent-lanes/ado-client/testing';
import { allowedLanes, BacklogPageSchema, dragLock, TeamBoardSchema, type ADO_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createConnectionsService } from '../connections';
import { createMemoryConnectionsFile } from '../connections/connections-file';
import { handleInvoke } from '../ipc/handle-invoke';
import { SECRETS_FILE_NAME, createSecretStore } from '../secrets';
import { createFakeSafeStorage } from '../secrets/testing';
import { createSettingsService } from '../settings/service';
import { createMemorySettingsFile } from '../settings/settings-file';
import { createAdoHandlers } from './handlers';
import { createAdoService } from './service';

/**
 * E14 team board channels through `handleInvoke` (request contract, handler, response contract),
 * against the fake CompanionSystems organisation with a PAT saved through Connections.
 */

type AdoChannel = (typeof ADO_INVOKE_CHANNELS)[number];

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-team-board-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function setupTeamOrg(options: { remotes?: AdoGitRemote[]; items?: FakeTeamOrgOptions['items'] } = {}) {
  const org = createFakeTeamOrg(options.items ? { items: options.items } : {});
  const secrets = createSecretStore({ filePath: join(dir, SECRETS_FILE_NAME), safeStorage: createFakeSafeStorage({ key: randomBytes(32) }), warn: () => undefined });
  const connections = createConnectionsService({ file: createMemoryConnectionsFile(), secrets, emit: () => undefined, warn: () => undefined });
  const saved = await connections.save({ kind: 'ado', orgUrl: FAKE_TEAM_ORG_URL, pat: FAKE_TEAM_PAT, defaultProject: FAKE_TEAM_PROJECT });
  if (!saved.ok) throw new Error(saved.message);
  const settings = createSettingsService({ file: createMemorySettingsFile(), warn: () => undefined });
  const handlers = createAdoHandlers(createAdoService({ connections, settings, fetch: org.fetch, registeredRemotes: async () => options.remotes ?? [] }));
  const call = <C extends AdoChannel>(channel: C, request: unknown) => handleInvoke(channel, request, handlers[channel]);
  return { org, call, orgId: saved.data.id };
}

describe('ado:listTeams and ado:teamBoard (AL-231)', () => {
  it('ado:listTeams lists your teams with OSC Developers as the default', async () => {
    const { call } = await setupTeamOrg();
    expect(await call('ado:listTeams', {})).toEqual({ ok: true, data: { teams: [OSC_DEVELOPERS, RELEASE_TRAIN], defaultTeamId: OSC_DEVELOPERS.id } });
  });

  it('the artboard 08 board (OSC Developers, Sprint 42) round-trips through ado:teamBoard', async () => {
    const { call, orgId } = await setupTeamOrg();
    const board = await call('ado:teamBoard', { org: orgId, project: FAKE_TEAM_PROJECT, team: 'OSC Developers', sprint: 'OnSite Companion\\Sprint 42' });
    if (!board.ok) throw new Error(board.message);
    expect(TeamBoardSchema.parse(board.data)).toEqual(board.data);
    expect(board.data.team.name).toBe('OSC Developers');
    expect(board.data.sprint.name).toBe('Sprint 42');
    expect(board.data.columns.map((column) => column.name)).toEqual(['To Do', 'In Progress', 'Code Review', 'Testing', 'Failed']);
    expect(board.data.items.map((item) => `${item.column} #${item.id} ${item.assignee?.initials ?? '–'}`)).toEqual([
      'To Do #71335 –',
      'To Do #71341 MD',
      'In Progress #71273 KR',
      'In Progress #71352 RJ',
      'Code Review #71298 TY',
      'Code Review #71301 KR',
      'Testing #71287 MD',
      'Testing #71310 KR',
      'Failed #71318 KR',
    ]);

    // Defaults: the profile team and its current sprint give the same board.
    expect(await call('ado:teamBoard', {})).toEqual(board);
  });

  it('feeds the drop rules: your Failed item may go to Planning, MD’s To Do item is locked', async () => {
    const { call } = await setupTeamOrg();
    const board = await call('ado:teamBoard', {});
    if (!board.ok) throw new Error(board.message);
    const me = { id: PEOPLE.KR.id };
    const card = (id: number) => {
      const item = board.data.items.find((candidate) => candidate.id === id)!;
      return {
        kind: 'board-item' as const,
        id,
        column: item.columnKind,
        assignee: item.assignee,
        agentLane: null,
        pullRequestId: item.pullRequestId,
        branch: item.branch,
      };
    };
    expect(Object.keys(allowedLanes(card(71318), me))).toEqual(['planning', 'implementing']);
    expect(allowedLanes(card(71341), me)).toEqual({});
    expect(Object.keys(allowedLanes(card(71298), me))).toEqual(['code-review']);
  });

  it('refuses a request with an unknown field, and reports a team ADO does not know', async () => {
    const { call } = await setupTeamOrg();
    expect(await call('ado:teamBoard', { teamName: 'x' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await call('ado:teamBoard', { team: 'Nobody' })).toMatchObject({ ok: false });
  });
});

describe('ado:activePrs (AL-232)', () => {
  const ONSITE = { orgUrl: FAKE_TEAM_ORG_URL, project: FAKE_TEAM_PROJECT, repository: 'onsite-companion' };

  it("round-trips the team's open PRs with unresolved thread counts and the unregistered repo flagged", async () => {
    const { call } = await setupTeamOrg({ remotes: [ONSITE] });
    const listed = await call('ado:activePrs', {});
    if (!listed.ok) throw new Error(listed.message);
    expect(listed.data.team).toEqual(OSC_DEVELOPERS);
    expect(listed.data.pullRequests.map((pr) => `!${pr.id} ${pr.unresolvedThreads} ${pr.repoRegistered ? 'registered' : 'add repo'}`)).toEqual([
      '!10598 4 registered',
      '!10590 0 add repo',
      '!10571 6 registered',
    ]);
  });

  it('feeds the drop rules: your PR with comments may be answered, any PR reviewed, an unregistered one refused with "Add repo"', async () => {
    const { call } = await setupTeamOrg({ remotes: [ONSITE] });
    const listed = await call('ado:activePrs', { team: 'OSC Developers' });
    if (!listed.ok) throw new Error(listed.message);
    const me = { id: PEOPLE.KR.id };
    const card = (id: number) => {
      const pr = listed.data.pullRequests.find((candidate) => candidate.id === id)!;
      return { kind: 'pull-request' as const, id, author: pr.author, unresolvedThreads: pr.unresolvedThreads, sourceBranch: pr.sourceBranch, repoRegistered: pr.repoRegistered };
    };
    expect(Object.keys(allowedLanes(card(10571), me))).toEqual(['implementing', 'code-review']);
    expect(Object.keys(allowedLanes(card(10598), me))).toEqual(['code-review']);
    expect(dragLock(card(10590), me)).toBe('Add repo');
  });

  it('with no registered repos, every PR is flagged', async () => {
    const { call } = await setupTeamOrg();
    const listed = await call('ado:activePrs', {});
    expect(listed.ok && listed.data.pullRequests.every((pr) => !pr.repoRegistered)).toBe(true);
  });
});

describe('ado:backlog (AL-233)', () => {
  it("artboard 11's 48-item backlog pages and groups through the channel", async () => {
    const { call } = await setupTeamOrg({ items: artboard11Backlog() });
    const first = await call('ado:backlog', { page: { index: 0, size: 7 } });
    if (!first.ok) throw new Error(first.message);
    expect(BacklogPageSchema.parse(first.data)).toEqual(first.data);
    expect(first.data.total).toBe(48);
    expect(first.data.groups.map((group) => `${group.feature?.title} ${group.items.map((item) => item.id).join(',')}`)).toEqual([
      'Job management 71360,71362,71371',
      'Client portal 71335,71377,71380',
      'Timesheets 71384',
    ]);

    const pages = await Promise.all([0, 1, 2].map((index) => call('ado:backlog', { team: 'OSC Developers', page: { index, size: 20 } })));
    const rows = pages.flatMap((page) => (page.ok ? page.data.groups.flatMap((group) => group.items.map((item) => item.id)) : []));
    expect(rows).toHaveLength(48);
    expect(new Set(rows).size).toBe(48);
    // Default page: the first 50.
    const whole = await call('ado:backlog', {});
    expect(whole.ok && whole.data.page).toEqual({ index: 0, size: 50, count: 1 });
  });

  it('filters combine with AND: portal-tagged bugs at priority 1', async () => {
    const { call } = await setupTeamOrg({ items: artboard11Backlog() });
    const page = await call('ado:backlog', { filters: { kinds: ['bug'], priorities: [1], tags: ['portal'] } });
    if (!page.ok) throw new Error(page.message);
    expect(page.data.groups.flatMap((group) => group.items.map((item) => item.id))).toEqual([71377]);
  });

  it('refuses a page size over 200 and an unknown filter before anything reaches ADO', async () => {
    const { call, org } = await setupTeamOrg({ items: artboard11Backlog() });
    expect(await call('ado:backlog', { page: { index: 0, size: 500 } })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await call('ado:backlog', { filters: { state: 'New' } })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(org.state.requests).toEqual([]);
  });
});

describe('ado:workItemColors', () => {
  it("returns the project's type and state colours and reuses them instead of reading the process again", async () => {
    const { call, org } = await setupTeamOrg();
    const first = await call('ado:workItemColors', {});
    if (!first.ok) throw new Error(first.message);
    expect(first.data.types['Bug']).toBe('#CC293D');
    expect(first.data.states['User Story']?.['Active']).toBe('#007ACC');

    expect(await call('ado:workItemColors', { project: FAKE_TEAM_PROJECT })).toEqual(first);
    expect(org.state.workItems.typeReads).toEqual([FAKE_TEAM_PROJECT]);
  });
});
