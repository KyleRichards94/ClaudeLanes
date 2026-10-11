import { createContext, useContext } from 'react';
import type { DropOnLane } from '../model/use-drop';

/** What the board's drag-to-lane provider gives the cards inside it. */
export interface DragToLaneContextValue {
  /** Drops a card on a lane: the pointer, keyboard drag and the "Send to lane" menu all end here. */
  drop: DropOnLane;
}

export const DragToLaneContext = createContext<DragToLaneContextValue | null>(null);

/** Null outside a `DragToLaneProvider` (the gallery's sample board): cards then just show. */
export function useDragToLane(): DragToLaneContextValue | null {
  return useContext(DragToLaneContext);
}

/** True inside a `DragToLaneProvider`: an agent card then wraps itself as a draggable (AL-274). */
export function useDragToLaneAvailable(): boolean {
  return useContext(DragToLaneContext) !== null;
}
