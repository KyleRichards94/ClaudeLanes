import type { Lane } from '@agent-lanes/contracts';
import { useDroppable } from '@dnd-kit/core';
import { useCallback } from 'react';
import { useLaneDropState } from '../model/drag-store';
import { registerLaneNode } from './lane-nodes.web';
import type { LaneDropTarget, LaneDropTargetOptions } from './lane-target';

/**
 * Web (Electron): the lane is a dnd-kit drop target, switched off while it refuses the dragged card
 * (or the caller switches it off). Its element is also registered for native drops from the
 * popped-out Backlog window (TB§5).
 */
export function useLaneDropTarget(lane: Lane, options: LaneDropTargetOptions = {}): LaneDropTarget {
  const state = useLaneDropState(lane);
  const id = options.placement ? `lane:${lane}:${options.placement}` : `lane:${lane}`;
  const { setNodeRef } = useDroppable({
    id,
    data: { lane },
    disabled: options.disabled === true || state.kind === 'refuse',
  });
  const attach = useCallback(
    (node: unknown) => {
      setNodeRef(node as HTMLElement | null);
      registerLaneNode(id, lane, node instanceof HTMLElement ? node : null);
    },
    [id, lane, setNodeRef],
  );
  return { attach, state };
}
