import type { Lane } from '@agent-lanes/contracts';
import { useLaneDropState } from '../model/drag-store';
import type { LaneDropState } from '../model/lane-state';

export interface LaneDropTarget {
  /** Goes on the lane's outermost element. */
  attach(node: unknown): void;
  state: LaneDropState;
}

/** Native builds have no drag: the lane only shows the state (the menu never lights lanes). */
export function useLaneDropTarget(lane: Lane): LaneDropTarget {
  return { attach: () => {}, state: useLaneDropState(lane) };
}
