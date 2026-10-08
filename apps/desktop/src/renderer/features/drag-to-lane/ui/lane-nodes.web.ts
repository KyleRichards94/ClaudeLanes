import type { Lane } from '@agent-lanes/contracts';

/** The lanes' elements on this page, for native drops (dnd-kit keeps its own list for its drags). */
const laneNodes = new Map<Lane, HTMLElement>();

export function registerLaneNode(lane: Lane, node: HTMLElement | null): void {
  if (node) laneNodes.set(lane, node);
  else laneNodes.delete(lane);
}

/** The lane the element is in, or null. */
export function laneAt(target: EventTarget | null): Lane | null {
  if (!(target instanceof Node)) return null;
  for (const [lane, node] of laneNodes) if (node.contains(target)) return lane;
  return null;
}
