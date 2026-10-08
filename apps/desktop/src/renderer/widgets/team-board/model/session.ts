import { create } from 'zustand';
import type { TeamBoardFilter } from './view';

interface TeamBoardSession {
  /** The team picked from the dropdown; null for the one from the user's ADO profile. */
  readonly teamId: string | null;
  readonly filter: TeamBoardFilter;
}

/**
 * The team board's team and filter, kept for the session (AL-234): in memory only, so they survive
 * leaving the board for a ticket and coming back, and a restart opens on the profile's team and
 * Everyone again.
 */
const useSession = create<TeamBoardSession>()(() => ({ teamId: null, filter: 'everyone' }));

export function useTeamBoardSession(): TeamBoardSession {
  const teamId = useSession((state) => state.teamId);
  const filter = useSession((state) => state.filter);
  return { teamId, filter };
}

export function setTeamBoardTeam(teamId: string | null): void {
  useSession.setState({ teamId });
}

export function setTeamBoardFilter(filter: TeamBoardFilter): void {
  useSession.setState({ filter });
}

/** Back to the profile's team and Everyone (tests). */
export function resetTeamBoardSession(): void {
  useSession.setState({ teamId: null, filter: 'everyone' });
}
