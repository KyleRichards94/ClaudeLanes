import { useEffect, useRef } from 'react';
import { announce, endDrag, getActiveDrag, setOverLane, startDrag } from '../model/drag-store';
import { activeDrag, dropAnnouncement } from '../model/lane-state';
import { NATIVE_BACKLOG_DRAG_TYPE, decodeNativeBacklogDrag, nativeBacklogPlaceholder } from '../model/native-drag';
import type { DropOnLane } from '../model/use-drop';
import { laneAt } from './lane-nodes.web';

function carriesBacklog(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes(NATIVE_BACKLOG_DRAG_TYPE);
}

/**
 * Takes native drags from the popped-out Backlog window (TB§5: "dragging between windows works
 * because both are the same Electron app"). While one is over this window the lanes light up as for a
 * dnd-kit drag (the rows can't be read until the drop, so every backlog lane lights); dropped on a lane
 * that takes it, each row starts its agent through the same drop as a dnd-kit drag.
 */
export function useNativeBacklogDrops(drop: DropOnLane): void {
  const dropRef = useRef(drop);
  useEffect(() => {
    dropRef.current = drop;
  }, [drop]);

  useEffect(() => {
    let native = false;
    const stop = () => {
      if (!native) return;
      native = false;
      endDrag();
    };
    const over = (event: DragEvent) => {
      if (!carriesBacklog(event)) return;
      if (!native || !getActiveDrag()) {
        native = true;
        startDrag(nativeBacklogPlaceholder(), 'pointer');
      }
      const lane = laneAt(event.target);
      const takes = lane !== null && Boolean(getActiveDrag()?.allowed[lane]);
      setOverLane(takes ? lane : null);
      if (!takes) return;
      // Only a lane that takes the rows accepts the drop.
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const leave = (event: DragEvent) => {
      // Left the window (no element to go to); moving between elements inside it fires leave too.
      if (event.relatedTarget === null) stop();
    };
    const onDrop = (event: DragEvent) => {
      if (!carriesBacklog(event)) return;
      event.preventDefault();
      const lane = laneAt(event.target);
      const active = getActiveDrag();
      stop();
      const card = decodeNativeBacklogDrag(event.dataTransfer?.getData(NATIVE_BACKLOG_DRAG_TYPE) ?? '');
      if (!lane || !card || !active?.allowed[lane]) return;
      announce(dropAnnouncement(activeDrag(card, 'pointer'), lane));
      void dropRef.current(card, lane);
    };
    window.addEventListener('dragenter', over);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('dragend', stop);
    return () => {
      window.removeEventListener('dragenter', over);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('dragend', stop);
      stop();
    };
  }, []);
}
