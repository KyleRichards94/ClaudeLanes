import { describe, expect, it, vi } from 'vitest';
import { err, ok, type ConnectionSummary } from '@agent-lanes/contracts';
import { createPeerConfigSync } from './config';
import { deriveTeam } from './signer';
import { createPeerTeams, type TeamSource } from './teams';

const ORG = 'https://devops:8090/tfs/DefaultCollection';
const PROJECT_IDS: Record<string, string> = { 'OnSite Companion': '6ce954b1-ce1f-45d1-b94d-e6bf2464ba2c', Liink: '0f7a4c2e-1b3d-4e5f-8a6b-9c0d1e2f3a4b' };
const DEFAULTS = { port: 47811, beaconPort: 47810, loopback: false };

function peersRow(port: number, addresses: string[]): ConnectionSummary {
  return {
    kind: 'peers', id: 'peers', name: 'Peers', port, beaconPort: 47810, addresses, identity: null, maskedToken: null, expiresAt: null, status: 'untested', statusMessage: null,
    needsReconnect: false, lastTestedAt: null, createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z',
  };
}

describe('createPeerTeams (AL-298)', () => {
  it('derives one team per organisation and project, reading each project id once', async () => {
    let sources: TeamSource[] = [{ orgUrl: ORG, project: 'OnSite Companion' }, { orgUrl: `${ORG}/`, project: 'onsite companion' }];
    const projectId = vi.fn(async (_org: string, project: string) => (PROJECT_IDS[project] ? ok(PROJECT_IDS[project]) : err('INTERNAL', 'offline')));
    const warn = vi.fn();
    const teams = createPeerTeams({ sources: async () => sources, projectId, log: { warn } });

    expect((await teams.current()).map((team) => team.tag)).toEqual([deriveTeam(ORG, PROJECT_IDS['OnSite Companion']!).tag]);
    sources = [...sources, { orgUrl: ORG, project: 'Liink' }, { orgUrl: ORG, project: 'Gone' }];
    expect(await teams.current()).toHaveLength(2);
    expect(await teams.current()).toHaveLength(2);
    expect(projectId.mock.calls.map(([, project]) => project)).toEqual(['OnSite Companion', 'Liink', 'Gone', 'Gone']);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('createPeerConfigSync (AL-298)', () => {
  it('starts with the first team, restarts only on new settings, swaps keys without a restart, and stops with no team', async () => {
    let rows: ConnectionSummary[] = [];
    let projects: string[] = [];
    const configure = vi.fn(async () => undefined);
    const setTeams = vi.fn();
    const teams = createPeerTeams({ sources: async () => projects.map((project) => ({ orgUrl: ORG, project })), projectId: async (_org, project) => ok(PROJECT_IDS[project]!) });
    const sync = createPeerConfigSync({ connections: { list: async () => rows }, teams, network: { configure, setTeams }, defaults: DEFAULTS });
    const osc = deriveTeam(ORG, PROJECT_IDS['OnSite Companion']!);
    const liink = deriveTeam(ORG, PROJECT_IDS['Liink']!);

    await sync.sync();
    expect(configure).not.toHaveBeenCalled();

    projects = ['OnSite Companion'];
    await sync.sync();
    await sync.sync();
    expect(configure).toHaveBeenCalledTimes(1);
    expect(configure).toHaveBeenLastCalledWith({ port: 47811, beaconPort: 47810, addresses: [], loopback: false, teams: [osc] });

    rows = [peersRow(47900, ['KYLE-PC'])];
    await sync.sync();
    expect(configure).toHaveBeenCalledTimes(2);
    expect(configure).toHaveBeenLastCalledWith({ port: 47900, beaconPort: 47810, addresses: ['KYLE-PC'], loopback: false, teams: [osc] });

    projects = ['OnSite Companion', 'Liink'];
    await sync.sync();
    expect(configure).toHaveBeenCalledTimes(2);
    expect(setTeams).toHaveBeenLastCalledWith([osc, liink]);

    projects = [];
    await sync.sync();
    expect(configure).toHaveBeenLastCalledWith(null);
  });
});
