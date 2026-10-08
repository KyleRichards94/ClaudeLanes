import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { adoFixture } from '@agent-lanes/contracts/testing';
import { installFakeBridge } from '@/shared/testing';
import { pickBoardTeam, useBoardSprint, useBoardTeam } from './board-team';
import { useUiPrefs } from './ui-prefs';

const fixture = adoFixture();
const OSC = { id: 'team-osc', name: 'OSC Developers' };
const RELEASE = { id: 'team-release', name: 'Release Train' };
const teamList = { teams: [RELEASE, OSC], defaultTeamId: OSC.id };

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  useUiPrefs.setState({ lastTeam: null, lastSprint: null });
  vi.restoreAllMocks();
});

describe('pickBoardTeam', () => {
  it('keeps the saved team while it is still one of the user’s teams', () => {
    expect(pickBoardTeam(teamList, RELEASE.id)).toEqual(RELEASE);
  });

  it('falls back to ADO’s default team, then to the first team', () => {
    expect(pickBoardTeam(teamList, null)).toEqual(OSC);
    expect(pickBoardTeam(teamList, 'team-gone')).toEqual(OSC);
    expect(pickBoardTeam({ teams: [RELEASE, OSC], defaultTeamId: null }, 'team-gone')).toEqual(RELEASE);
    expect(pickBoardTeam({ teams: [], defaultTeamId: null }, null)).toBeNull();
  });
});

describe('useBoardTeam / useBoardSprint', () => {
  it('reads the board team’s sprints, and only once the team is known', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bridge = installFakeBridge({ 'ado:listTeams': { ok: true, data: teamList }, 'ado:listSprints': { ok: true, data: fixture.sprints } });
    const hook = renderHook(() => ({ team: useBoardTeam(), sprint: useBoardSprint() }), { wrapper });

    await waitFor(() => expect(hook.result.current.sprint?.name).toBe('Sprint 42'));
    expect(hook.result.current.team).toEqual(OSC);
    const sprintCalls = vi.mocked(bridge.invoke).mock.calls.filter(([channel]) => channel === 'ado:listSprints');
    expect(sprintCalls).toEqual([['ado:listSprints', { team: OSC.id }]]);
  });

  it('lets main resolve the team when the teams cannot be read', async () => {
    const bridge = installFakeBridge({
      'ado:listTeams': { ok: false, code: 'INTERNAL', message: 'down' },
      'ado:listSprints': { ok: true, data: fixture.sprints },
    });
    const hook = renderHook(() => ({ team: useBoardTeam(), sprint: useBoardSprint() }), { wrapper });

    await waitFor(() => expect(hook.result.current.sprint?.name).toBe('Sprint 42'));
    expect(hook.result.current.team).toBeNull();
    expect(bridge.invoke).toHaveBeenCalledWith('ado:listSprints', {});
  });
});
