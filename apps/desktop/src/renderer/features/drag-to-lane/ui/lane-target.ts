import type { Lane } from '@agent-lanes/contracts';
import { useLaneDropState } from '../model/drag-store';
import type { LaneDropState } from '../model/lane-state';

export interface LaneDropTarget {
  /** Goes on the lane's outermost element. */
  attach(node: unknown): void;
  state: LaneDropState;
}

export interface LaneDropTargetOptions {
  /**
   * Another target for the same lane ("strip": its cell in the collapsed agent board). Each placement
   * is its own drop target; a drop on any of them goes to the lane.
   */
  placement?: string;
  /** Takes no drops, e.g. while it is hidden. Its look still follows the drag. */
  disabled?: boolean;
}

/** Native builds have no drag: the lane only shows the state (the menu never lights lanes). */
export function useLaneDropTarget(lane: Lane, _options: LaneDropTargetOptions = {}): LaneDropTarget {
  return { attach: () => {}, state: useLaneDropState(lane) };
}
