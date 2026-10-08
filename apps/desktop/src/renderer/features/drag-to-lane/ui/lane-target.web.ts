import type { Lane } from '@agent-lanes/contracts';
import { useDroppable } from '@dnd-kit/core';
import { useLaneDropState } from '../model/drag-store';
import type { LaneDropTarget } from './lane-target';

/** Web (Electron): the lane is a dnd-kit drop target, switched off while it refuses the dragged card. */
export function useLaneDropTarget(lane: Lane): LaneDropTarget {
  const state = useLaneDropState(lane);
  const { setNodeRef } = useDroppable({
    id: `lane:${lane}`,
    data: { lane },
    disabled: state.kind === 'refuse',
  });
  return { attach: (node) => setNodeRef(node as HTMLElement | null), state };
}
