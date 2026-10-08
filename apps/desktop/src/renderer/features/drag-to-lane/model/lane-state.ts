import { LANES, type Lane } from '@agent-lanes/contracts';
import { DROP_REFUSALS, LANE_LABELS, allowedLanes, refusedLanes, type DropAction } from '@/entities/agent-ticket';
import type { DragInput, LaneDragCard } from './types';

/** A card being dragged, with what each lane does with it (AL-230's rules, worked out once at pick-up). */
export interface ActiveDrag {
  card: LaneDragCard;
  allowed: Partial<Record<Lane, DropAction>>;
  refused: Partial<Record<Lane, string>>;
  input: DragInput;
}

/** The cards a drag carries: the group it was picked up with, or just the card. */
export function dragMembers(card: LaneDragCard): readonly LaneDragCard[] {
  return card.group && card.group.length > 0 ? card.group : [card];
}

/** "Plan this" → "Plan these" for a group (artboard 12). */
function forSeveral(action: DropAction): DropAction {
  return { ...action, title: action.title.replace(/\bthis\b/, 'these') };
}

/**
 * What each lane does with the card, or with every card of its group: a group goes only to the lanes
 * that take each of its cards (one agent per card), titled for several ("Plan these").
 */
function lanesFor(card: LaneDragCard): Partial<Record<Lane, DropAction>> {
  const members = dragMembers(card);
  if (members.length <= 1) return allowedLanes(card.card, card.me);
  const each = members.map((member) => allowedLanes(member.card, member.me));
  const allowed: Partial<Record<Lane, DropAction>> = {};
  for (const lane of LANES) {
    const first = each[0]?.[lane];
    if (first && each.every((lanes) => lanes[lane])) allowed[lane] = forSeveral(first);
  }
  return allowed;
}

/** "#71360", or "2 items" for a group. */
export function dragLabel(card: LaneDragCard): string {
  const count = dragMembers(card).length;
  return count > 1 ? `${count} items` : card.label;
}

export function activeDrag(card: LaneDragCard, input: DragInput): ActiveDrag {
  const several = dragMembers(card).length > 1;
  return {
    // A group is announced and previewed as "2 items".
    card: several ? { ...card, label: dragLabel(card) } : card,
    allowed: lanesFor(card),
    refused: refusedLanes(card.card, card.me),
    input,
  };
}

/**
 * How a lane looks while a card is dragged (T2, TB§7, artboard 09):
 * - `accept`: it takes the card; it lights up with the action and a dashed border, solid while the card is over it;
 * - `refuse`: it does not; it dims, and says why when the reason helps ("No linked PR" on Code review);
 * - `idle`: nothing is being dragged.
 */
export type LaneDropState = { kind: 'idle' } | { kind: 'accept'; action: DropAction; over: boolean } | { kind: 'refuse'; reason: string | null };

/** Refusals worth saying on the lane; the rest (Queued, Create PR, "not this lane") just dim it. */
const SHOWN_REFUSALS: ReadonlySet<string> = new Set([DROP_REFUSALS.noLinkedPr, DROP_REFUSALS.noComments, DROP_REFUSALS.notAuthor, DROP_REFUSALS.addRepo]);

export function laneDropState(active: ActiveDrag | null, lane: Lane, overLane: Lane | null): LaneDropState {
  if (!active) return { kind: 'idle' };
  const action = active.allowed[lane];
  if (action) return { kind: 'accept', action, over: overLane === lane };
  const reason = active.refused[lane];
  return {
    kind: 'refuse',
    reason: reason !== undefined && SHOWN_REFUSALS.has(reason) ? reason : null,
  };
}

/** The lanes that take the card, left to right, with what each drop does: the "Send to lane" menu. */
export function allowedLaneList(card: LaneDragCard): { lane: Lane; action: DropAction }[] {
  const allowed = lanesFor(card);
  return LANES.flatMap((lane) => {
    const action = allowed[lane];
    return action ? [{ lane, action }] : [];
  });
}

function joinLanes(lanes: readonly Lane[], word = 'and'): string {
  const names = lanes.map((lane) => LANE_LABELS[lane]);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} ${word} ${names.at(-1)}`;
}

// ── Announcements (TB§7: "Over Code review: start agentic review") ─────────────────────────────

/** Read out on every draggable card (dnd-kit's `aria-describedby`). */
export const DRAG_INSTRUCTIONS =
  'To start an agent, press Space to pick the card up, the arrow keys to move between the lanes that take it, Space to drop it and Escape to cancel. Enter opens the Send to lane menu.';

export function pickUpAnnouncement(active: ActiveDrag): string {
  const lanes = LANES.filter((lane) => active.allowed[lane]);
  if (lanes.length === 0) return `Picked up ${active.card.label}. No lane takes it.`;
  const takes = `${joinLanes(lanes)} ${lanes.length === 1 ? 'takes' : 'take'} it.`;
  return active.input === 'keyboard'
    ? `Picked up ${active.card.label}. ${takes} Use the arrow keys to move between them, Space to drop, Escape to cancel.`
    : `Picked up ${active.card.label}. ${takes}`;
}

export function overAnnouncement(active: ActiveDrag, lane: Lane | null): string {
  const action = lane ? active.allowed[lane] : undefined;
  if (!lane || !action) return `${active.card.label} is not over a lane that takes it.`;
  return `Over ${LANE_LABELS[lane]}: ${action.label}`;
}

export function dropAnnouncement(active: ActiveDrag, lane: Lane | null): string {
  const action = lane ? active.allowed[lane] : undefined;
  if (!lane || !action) return `${active.card.label} was not dropped on a lane. It is back in its column.`;
  return `Dropped ${active.card.label} on ${LANE_LABELS[lane]}: ${action.label}`;
}

export function cancelAnnouncement(active: ActiveDrag): string {
  return `Cancelled. ${active.card.label} is back in its column.`;
}

export function sentAnnouncement(card: LaneDragCard, lane: Lane, action: DropAction): string {
  return `Sent ${dragLabel(card)} to ${LANE_LABELS[lane]}: ${action.label}`;
}

/**
 * "Drop !10571 on a highlighted lane" (artboard 09's header pill), or for a group "Dragging 2 items —
 * drop on Planning or Implementing" (artboard 12).
 */
export function dragStatusText(active: ActiveDrag): string {
  const lanes = LANES.filter((lane) => active.allowed[lane]);
  if (lanes.length === 0) return `No lane takes ${active.card.label}`;
  if (dragMembers(active.card).length > 1) return `Dragging ${active.card.label} — drop on ${joinLanes(lanes, 'or')}`;
  return `Drop ${active.card.label} on a highlighted lane`;
}
