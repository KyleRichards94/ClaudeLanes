import type { Lane } from '@agent-lanes/contracts';

/**
 * The drop targets' elements on this page, by droppable id, for native drops (dnd-kit keeps its own
 * list for its drags). A lane can have two: the full lane and its cell in the collapsed agent board.
 */
const laneNodes = new Map<string, { lane: Lane; node: HTMLElement }>();

export function registerLaneNode(id: string, lane: Lane, node: HTMLElement | null): void {
  if (node) laneNodes.set(id, { lane, node });
  else laneNodes.delete(id);
}

/** The lane the element is in, or null. */
export function laneAt(target: EventTarget | null): Lane | null {
  if (!(target instanceof Node)) return null;
  for (const { lane, node } of laneNodes.values()) if (node.contains(target)) return lane;
  return null;
}
