import { pickSprint, type Sprint } from '@agent-lanes/contracts';
import { useSprints } from '@/shared/api';
import { useUiPrefs } from '@/shared/model';

/**
 * The sprint the board shows (AL-142): the one picked from the Sprint menu while the team still has
 * it, else the current one (AL-061 `pickSprint`). Null while loading, on an error or with no sprints.
 * The sprints poll every 60 s while the board is open (AL-066).
 */
export function useBoardSprint(): Sprint | null {
  const sprints = useSprints({}, { live: true });
  const lastSprint = useUiPrefs((state) => state.lastSprint);
  return sprints.data ? pickSprint(sprints.data, lastSprint) : null;
}
