import type { RoomMessage } from '@agent-lanes/contracts';

/** How close to the end of the log still counts as at the bottom. */
export const AT_BOTTOM_PX = 24;

export interface ScrollMetrics {
  contentOffset: { y: number };
  contentSize: { height: number };
  layoutMeasurement: { height: number };
}

export function atBottom(metrics: ScrollMetrics): boolean {
  return metrics.contentSize.height - (metrics.contentOffset.y + metrics.layoutMeasurement.height) <= AT_BOTTOM_PX;
}

/**
 * What new rows do to the log (AL-301): followed when the view is at the bottom or one is the person's
 * own post; otherwise the view stays put and the posts among them are counted for the pill. A joined,
 * left or lost-contact row is never counted.
 */
export function arrivals(added: readonly RoomMessage[], pinned: boolean): { follow: boolean; unseen: number } {
  if (pinned || added.some((message) => message.own && message.from.person && !message.system)) return { follow: true, unseen: 0 };
  return { follow: false, unseen: added.filter((message) => !message.system).length };
}

export function newMessagesLabel(count: number): string {
  return count > 1 ? `${count} new messages` : 'New messages';
}
