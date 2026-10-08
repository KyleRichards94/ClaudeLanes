import type { Lane } from '@agent-lanes/contracts';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type Over,
} from '@dnd-kit/core';
import { useEffect, useMemo, useRef } from 'react';
import { endDrag, setOverLane, startDrag } from '../model/drag-store';
import { LANE_KEYBOARD_CODES, laneKeyboardCoordinates } from '../model/keyboard';
import { DRAG_INSTRUCTIONS, cancelAnnouncement, dropAnnouncement, overAnnouncement, pickUpAnnouncement, type ActiveDrag } from '../model/lane-state';
import type { LaneDragCard } from '../model/types';
import { useDropOnLane } from '../model/use-drop';
import { AnnouncementRegion } from './AnnouncementRegion';
import { DragToLaneContext } from './context';
import { DragPreview } from './DragPreview';
import type { DragToLaneProviderProps } from './DragToLaneProvider';

function laneOf(over: Over | null): Lane | null {
  const lane = (over?.data.current as { lane?: Lane } | undefined)?.lane;
  return lane ?? null;
}

/** The pointer has to be inside a lane; a keyboard drag (no pointer) lands on the lane the card overlaps most. */
const laneCollisions: CollisionDetection = (args) => (args.pointerCoordinates ? pointerWithin(args) : rectIntersection(args));

/**
 * Web (Electron): drag from the team board to the agent lanes with dnd-kit (T2, TB§6, TB§7). The
 * pointer picks a card up after 4 px; Space picks up a focused card, arrows move between the lanes
 * that take it, Space or Enter drops, Escape cancels. Every pick-up, move, drop and cancel is
 * announced ("Over Code review: start agentic review"). Holding Alt at the drop is passed on, for the
 * launch sheet (AL-240). Wraps the whole board, so the lanes and the team board share one drag.
 */
export function DragToLaneProvider({ onLaunch, children }: DragToLaneProviderProps) {
  const drop = useDropOnLane(onLaunch);
  const value = useMemo(() => ({ drop }), [drop]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: LANE_KEYBOARD_CODES,
      coordinateGetter: laneKeyboardCoordinates,
    }),
  );

  // The last drag, kept after it ends so its drop or cancel can still be announced.
  const lastDrag = useRef<ActiveDrag | null>(null);
  const altHeld = useRef(false);

  useEffect(() => {
    const track = (event: KeyboardEvent | PointerEvent) => {
      altHeld.current = event.altKey;
    };
    window.addEventListener('keydown', track, true);
    window.addEventListener('keyup', track, true);
    window.addEventListener('pointermove', track, true);
    window.addEventListener('pointerup', track, true);
    return () => {
      window.removeEventListener('keydown', track, true);
      window.removeEventListener('keyup', track, true);
      window.removeEventListener('pointermove', track, true);
      window.removeEventListener('pointerup', track, true);
    };
  }, []);

  const announcements = useMemo<Announcements>(
    () => ({
      onDragStart: () => (lastDrag.current ? pickUpAnnouncement(lastDrag.current) : undefined),
      onDragOver: ({ over }) => (lastDrag.current ? overAnnouncement(lastDrag.current, laneOf(over)) : undefined),
      onDragEnd: ({ over }) => (lastDrag.current ? dropAnnouncement(lastDrag.current, laneOf(over)) : undefined),
      onDragCancel: () => (lastDrag.current ? cancelAnnouncement(lastDrag.current) : undefined),
    }),
    [],
  );

  const onDragStart = (event: DragStartEvent) => {
    const card = event.active.data.current as LaneDragCard | undefined;
    if (!card) return;
    lastDrag.current = startDrag(card, event.activatorEvent instanceof KeyboardEvent ? 'keyboard' : 'pointer');
  };
  const onDragOver = (event: DragOverEvent) => setOverLane(laneOf(event.over));
  const onDragEnd = (event: DragEndEvent) => {
    const active = lastDrag.current;
    const lane = laneOf(event.over);
    endDrag();
    if (active && lane && active.allowed[lane]) void drop(active.card, lane, { alt: altHeld.current });
  };

  return (
    <DragToLaneContext.Provider value={value}>
      <DndContext
        sensors={sensors}
        collisionDetection={laneCollisions}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: DRAG_INSTRUCTIONS },
        }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => endDrag()}
      >
        {children}
        <DragOverlay dropAnimation={null}>
          <DragPreview />
        </DragOverlay>
      </DndContext>
      <AnnouncementRegion />
    </DragToLaneContext.Provider>
  );
}
