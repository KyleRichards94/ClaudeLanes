import type { KeyboardCodes, KeyboardCoordinateGetter } from '@dnd-kit/core';

/**
 * dnd-kit's keyboard sensor for the lanes (TB§7): Space picks a card up, Space or Enter drops it,
 * Escape cancels. Enter does not pick up, because on a resting card it opens the "Send to lane" menu;
 * Tab cancels rather than drops, so leaving the card never starts an agent.
 */
export const LANE_KEYBOARD_CODES: KeyboardCodes = {
  start: ['Space'],
  cancel: ['Escape', 'Tab'],
  end: ['Space', 'Enter'],
};

const FORWARD = new Set(['ArrowRight', 'ArrowDown']);
const BACK = new Set(['ArrowLeft', 'ArrowUp']);

/** How far below a lane's top edge the card lands: under the lane's header, over its first card. */
const BELOW_LANE_HEADER = 56;

/**
 * Arrow keys jump between the lanes that take the card, left to right (lanes that refuse it are
 * disabled drop targets and skipped). From the team board, the first arrow goes to the first such
 * lane (Left: the last). The card is centred on the lane under its header, so it overlaps that lane
 * most and the lane becomes the drop target.
 */
export const laneKeyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  const forward = FORWARD.has(event.code);
  if (!forward && !BACK.has(event.code)) return undefined;
  event.preventDefault();
  const { collisionRect, droppableContainers, droppableRects, over } = context;
  if (!collisionRect) return undefined;

  const lanes = droppableContainers
    .getEnabled()
    .flatMap((container) => {
      const rect = droppableRects.get(container.id);
      return rect ? [{ id: container.id, rect }] : [];
    })
    .sort((a, b) => a.rect.left - b.rect.left);
  if (lanes.length === 0) return undefined;

  const index = over ? lanes.findIndex((lane) => lane.id === over.id) : -1;
  let next: number;
  if (index === -1) next = event.code === 'ArrowLeft' ? lanes.length - 1 : 0;
  else next = forward ? Math.min(index + 1, lanes.length - 1) : Math.max(index - 1, 0);
  if (next === index) return undefined;

  const target = lanes[next]!.rect;
  return {
    x: target.left + (target.width - collisionRect.width) / 2,
    y: target.top + BELOW_LANE_HEADER,
  };
};
