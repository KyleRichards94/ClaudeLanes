import { pickSprint, type Sprint, type TeamList, type TeamRef } from '@agent-lanes/contracts';
import { useSprints, useTeams, type AdoQueryOptions } from '@/shared/api';
import { useUiPrefs } from './ui-prefs';

/**
 * The board's team and sprint. Sprints are chosen per team in ADO, and Azure DevOps Server only
 * answers the team-scoped sprint route, so every sprint or team read on the board (the Sprint menu,
 * the sub-header, the New agent ticket modal, the team board) passes the same team: the one picked
 * in the board's Team menu, kept in the UI prefs as `lastTeam`.
 */

/** `lastTeam` while it is still one of the user's teams, else ADO's default team, else the first team. */
export function pickBoardTeam(list: TeamList, lastTeam: string | null | undefined): TeamRef | null {
  const find = (id: string | null | undefined) => (id ? list.teams.find((team) => team.id === id) : undefined);
  return find(lastTeam) ?? find(list.defaultTeamId) ?? list.teams[0] ?? null;
}

/** The team the board shows (see {@link pickBoardTeam}). Null while the teams load, on an error, or with none. */
export function useBoardTeam(): TeamRef | null {
  const teams = useTeams();
  const lastTeam = useUiPrefs((state) => state.lastTeam);
  return teams.data ? pickBoardTeam(teams.data, lastTeam) : null;
}

/**
 * The board team's sprints. Held while the teams load, so the sprints are read once for the right
 * team; if the teams can't be read, main resolves the user's default team itself.
 */
export function useBoardSprints(options: AdoQueryOptions = {}) {
  const teams = useTeams();
  const team = useBoardTeam();
  return useSprints(team ? { team: team.id } : {}, { ...options, enabled: !teams.isPending });
}

/**
 * The sprint the board shows (AL-142): the one picked from the Sprint menu while the team still has
 * it, else the current one (AL-061 `pickSprint`). Null while loading, on an error or with no sprints.
 * The sprints poll every 60 s while the board is open (AL-066).
 */
export function useBoardSprint(): Sprint | null {
  const sprints = useBoardSprints({ live: true });
  const lastSprint = useUiPrefs((state) => state.lastSprint);
  return sprints.data ? pickSprint(sprints.data, lastSprint) : null;
}
