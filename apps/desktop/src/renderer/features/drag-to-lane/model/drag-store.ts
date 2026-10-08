import type { Lane } from '@agent-lanes/contracts';
import { create } from 'zustand';
import { activeDrag, laneDropState, type ActiveDrag, type LaneDropState } from './lane-state';
import type { DragInput, LaneDragCard } from './types';

interface DragState {
  active: ActiveDrag | null;
  /** The accepting lane the card is over, or null. */
  overLane: Lane | null;
  /**
   * Work items dropped on a lane whose launch main has not confirmed yet, by id: the team board shows
   * "Agent in Planning" on them straight away (the optimistic update), until the launch is confirmed
   * (the ticket store then has the agent) or fails.
   */
  pendingLanes: Readonly<Record<string, Lane>>;
  /** The last thing said in the polite live region; `seq` makes a repeat of the same text read again. */
  announcement: { text: string; seq: number };
}

const INITIAL: DragState = {
  active: null,
  overLane: null,
  pendingLanes: {},
  announcement: { text: '', seq: 0 },
};

/** The drag in progress and the drops waiting on main. In memory only. */
const useDragStore = create<DragState>()(() => INITIAL);

export function startDrag(card: LaneDragCard, input: DragInput): ActiveDrag {
  const active = activeDrag(card, input);
  useDragStore.setState({ active, overLane: null });
  return active;
}

export function setOverLane(lane: Lane | null): void {
  useDragStore.setState({ overLane: lane });
}

export function endDrag(): void {
  useDragStore.setState({ active: null, overLane: null });
}

export function getActiveDrag(): ActiveDrag | null {
  return useDragStore.getState().active;
}

export function setPendingLane(workItemId: number, lane: Lane): void {
  useDragStore.setState(({ pendingLanes }) => ({
    pendingLanes: { ...pendingLanes, [String(workItemId)]: lane },
  }));
}

export function clearPendingLane(workItemId: number): void {
  useDragStore.setState(({ pendingLanes }) => {
    const { [String(workItemId)]: _dropped, ...rest } = pendingLanes;
    return { pendingLanes: rest };
  });
}

/** Says `text` in the drag-to-lane live region (a keyboard menu drop; dnd-kit announces drags itself). */
export function announce(text: string): void {
  useDragStore.setState(({ announcement }) => ({
    announcement: { text, seq: announcement.seq + 1 },
  }));
}

/** Back to no drag and no pending drops (tests). */
export function resetDragToLane(): void {
  useDragStore.setState(INITIAL, true);
}

export function useActiveDrag(): ActiveDrag | null {
  return useDragStore((state) => state.active);
}

/** How `lane` looks right now: idle, lit with its action, or dimmed. */
export function useLaneDropState(lane: Lane): LaneDropState {
  const active = useDragStore((state) => state.active);
  const overLane = useDragStore((state) => state.overLane);
  return laneDropState(active, lane, overLane);
}

/** True while this card is being dragged, alone or with the rest of its group. */
export function useIsDragging(key: string): boolean {
  return useDragStore((state) => {
    const card = state.active?.card;
    if (!card) return false;
    return card.key === key || (card.group?.some((member) => member.key === key) ?? false);
  });
}

export function usePendingDropLanes(): Readonly<Record<string, Lane>> {
  return useDragStore((state) => state.pendingLanes);
}

export function useDragAnnouncement(): { text: string; seq: number } {
  return useDragStore((state) => state.announcement);
}
