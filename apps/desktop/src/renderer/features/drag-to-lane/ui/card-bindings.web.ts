import { useDraggable } from '@dnd-kit/core';
import type { LaneDragCard } from '../model/types';
import type { CardDragBindings } from './card-bindings';

/** Web (Electron): the card is a dnd-kit draggable; react-native-web passes the pointer and key handlers to the DOM. */
export function useCardDragBindings(card: LaneDragCard): CardDragBindings {
  const { setNodeRef, attributes, listeners } = useDraggable({
    id: card.key,
    data: card,
  });
  return {
    setNodeRef: (node) => setNodeRef(node as HTMLElement | null),
    attributes: attributes as unknown as Record<string, unknown>,
    listeners: (listeners ?? {}) as CardDragBindings['listeners'],
  };
}
