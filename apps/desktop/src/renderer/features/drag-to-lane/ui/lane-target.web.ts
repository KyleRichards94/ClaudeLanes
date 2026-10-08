import type { Lane } from '@agent-lanes/contracts';
import { useDroppable } from '@dnd-kit/core';
import { useCallback } from 'react';
import { useLaneDropState } from '../model/drag-store';
import { registerLaneNode } from './lane-nodes.web';
import type { LaneDropTarget } from './lane-target';

/**
 * Web (Electron): the lane is a dnd-kit drop target, switched off while it refuses the dragged card.
 * Its element is also registered for native drops from the popped-out Backlog window (TB§5).
 */
export function useLaneDropTarget(lane: Lane): LaneDropTarget {
  const state = useLaneDropState(lane);
  const { setNodeRef } = useDroppable({
    id: `lane:${lane}`,
    data: { lane },
    disabled: state.kind === 'refuse',
  });
  const attach = useCallback(
    (node: unknown) => {
      setNodeRef(node as HTMLElement | null);
      registerLaneNode(lane, node instanceof HTMLElement ? node : null);
    },
    [lane, setNodeRef],
  );
  return { attach, state };
}
