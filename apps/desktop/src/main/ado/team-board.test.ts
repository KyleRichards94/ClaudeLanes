import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdoGitRemote } from '@agent-lanes/ado-client';
import { createFakeTeamOrg, FAKE_TEAM_ORG_URL, FAKE_TEAM_PAT, FAKE_TEAM_PROJECT, OSC_DEVELOPERS, PEOPLE, RELEASE_TRAIN } from '@agent-lanes/ado-client/testing';
import { allowedLanes, dragLock, TeamBoardSchema, type ADO_INVOKE_CHANNELS } from '@agent-lanes/contracts';
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

async function setupTeamOrg(options: { remotes?: AdoGitRemote[] } = {}) {
  const org = createFakeTeamOrg();
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
