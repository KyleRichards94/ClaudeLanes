import type { TicketLayout } from '@/shared/model';

/** The control's measurements (handoff "Layout slider > The control"). */
export const SLIDER_WIDTH = 260;
export const SLIDER_HEIGHT = 40;
/** The thumb sits 4 px inside the track. */
export const SLIDER_INSET = 4;
/** One segment, and so how far the thumb travels. */
export const SEGMENT_WIDTH = (SLIDER_WIDTH - 2 * SLIDER_INSET) / 2;
/** A press that moves less than this is a click, not a drag. */
export const DRAG_THRESHOLD = 4;

export const SLIDER_OPTIONS = [
  { value: 'flightDeck', label: 'Flight deck', icon: 'layout-columns' },
  { value: 'codeCity', label: 'Code city', icon: 'buildings' },
] as const satisfies readonly { value: TicketLayout; label: string; icon: string }[];

/** Where the thumb rests for a layout, in px from its left position. */
export function thumbOffsetFor(layout: TicketLayout): number {
  return layout === 'codeCity' ? SEGMENT_WIDTH : 0;
}

/** The layout a thumb dragged to `offset` px snaps to on release: the nearer side. */
export function snapLayout(offset: number): TicketLayout {
  return offset > SEGMENT_WIDTH / 2 ? 'codeCity' : 'flightDeck';
}

/** The thumb's offset after dragging `delta` px from where it started, kept on the track. */
export function dragOffset(start: number, delta: number): number {
  return Math.min(SEGMENT_WIDTH, Math.max(0, start + delta));
}
