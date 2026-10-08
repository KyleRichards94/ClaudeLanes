import type { LaneDragCard } from '../model/types';

/** What a draggable card puts on its element: dnd-kit's ref, attributes and listeners on web. */
export interface CardDragBindings {
  setNodeRef(node: unknown): void;
  /** `role`, `tabIndex`, `aria-roledescription`, `aria-describedby`, …; empty on native. */
  attributes: Record<string, unknown>;
  /** The sensors' activators (`onPointerDown`, `onKeyDown`); empty on native. */
  listeners: { onKeyDown?: (event: unknown) => void } & Record<string, unknown>;
}

const NONE: CardDragBindings = {
  setNodeRef: () => {},
  attributes: {},
  listeners: {},
};

/** Native builds have no dnd-kit (it is DOM-only): cards are sent to a lane from the menu instead. */
export function useCardDragBindings(_card: LaneDragCard): CardDragBindings {
  return NONE;
}
