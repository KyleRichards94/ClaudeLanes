import { useQuery } from '@tanstack/react-query';
import { ADO_REFETCH_INTERVAL_MS, type AdoScope } from './ado';
import { invoke, unwrap } from './ipc';

/**
 * The team board's server state (AL-234, TB§6): the team's ADO board for a sprint, its open pull
 * requests (the team list is `useTeams` in `./ado`) and the backlog's size, read through AL-231–AL-233's channels. Keys follow
 * TB§6 (`['ado','teamBoard',team,sprint]`, `['ado','activePrs',team]`) under `['ado']`, so a
 * `connections:changed` refetch reaches them. Board and PRs refresh every 60 s while the window can
 * be seen, and on focus.
 */
export const teamBoardKeys = {
  /** `team` null: the team from the user's ADO profile. `sprint` null: the team's current sprint. */
  teamBoard: (team: string | null, sprint: string | null) => ['ado', 'teamBoard', team, sprint] as const,
  activePrs: (team: string | null) => ['ado', 'activePrs', team] as const,
  backlogTotal: (team: string | null) => ['ado', 'backlog', team, 'total'] as const,
};

const live = {
  refetchInterval: ADO_REFETCH_INTERVAL_MS,
  refetchIntervalInBackground: false,
  refetchOnWindowFocus: true,
} as const;

/** A team's board columns and the sprint's items on it (AL-231). */
export function useTeamBoard(team: string | null, sprint: string | null) {
  return useQuery({
    queryKey: teamBoardKeys.teamBoard(team, sprint),
    queryFn: async () => unwrap(await invoke('ado:teamBoard', { ...(team ? { team } : {}), ...(sprint ? { sprint } : {}) })),
    ...live,
  });
}

/** The team's open pull requests with unresolved thread counts (AL-232). */
export function useActivePrs(team: string | null) {
  return useQuery({
    queryKey: teamBoardKeys.activePrs(team),
    queryFn: async () => unwrap(await invoke('ado:activePrs', team ? { team } : {})),
    ...live,
  });
}

/** How many items the team's backlog holds, for the "Backlog 48" button (AL-233): one row is read for the total. */
export function useBacklogTotal(team: string | null) {
  return useQuery({
    queryKey: teamBoardKeys.backlogTotal(team),
    queryFn: async () => unwrap(await invoke('ado:backlog', { ...(team ? { team } : {}), page: { index: 0, size: 1 } })).total,
    ...live,
  });
}
