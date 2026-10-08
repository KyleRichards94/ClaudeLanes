import type { DropMe } from '@/entities/agent-ticket';
import { dragMembers } from './lane-state';
import type { LaneDragCard } from './types';

/**
 * Native HTML5 drag between the popped-out Backlog window and the main window (TB§5, TB§6): the
 * backlog rows put this type on the drag, the main window's lanes take it. dnd-kit only works inside
 * one window, so this is the one place native drag is used.
 */
export const NATIVE_BACKLOG_DRAG_TYPE = 'application/x-agent-lanes-backlog';

/** The most rows one native drag carries (a backlog page is at most 200; nobody drags more than a handful). */
const MAX_ROWS = 50;
const MAX_TITLE = 512;

/** What the drag carries per row: only ids and titles. Main reads each item again before acting (AL-236). */
interface NativeRow {
  id: number;
  title: string;
}

/** The backlog rows a drag carries, as the drag's data for `NATIVE_BACKLOG_DRAG_TYPE`. */
export function encodeNativeBacklogDrag(card: LaneDragCard): string {
  const rows: NativeRow[] = dragMembers(card).flatMap((member) =>
    member.card.kind === 'backlog-item' ? [{ id: member.card.id, title: member.title.slice(0, MAX_TITLE) }] : [],
  );
  return JSON.stringify({ rows: rows.slice(0, MAX_ROWS) });
}

/**
 * The signed-in user as a dropped backlog row knows them. A row is only draggable in the Backlog
 * window when it is yours or unassigned and has no agent, and main rechecks the assignee before the one
 * ADO change, so the drop here treats the rows as unassigned.
 */
const NATIVE_ME: DropMe = { id: 'agent-lanes:me' };

function rowCard(row: NativeRow): LaneDragCard {
  return {
    key: `backlog:${row.id}`,
    label: `#${row.id}`,
    title: row.title,
    card: { kind: 'backlog-item', id: row.id, assignee: null, agentLane: null },
    me: NATIVE_ME,
    meName: null,
    source: { kind: 'backlog-item', id: row.id },
  };
}

function isRow(value: unknown): value is NativeRow {
  if (typeof value !== 'object' || value === null) return false;
  const { id, title } = value as { id?: unknown; title?: unknown };
  return typeof id === 'number' && Number.isInteger(id) && id > 0 && id <= 2_147_483_647 && typeof title === 'string';
}

/**
 * The cards a native drop carries, as one card (with a `group` when there are several), or null when
 * the data is not a backlog drag. Anything can be dragged onto a window, so the data is checked here
 * and only ids and titles are kept.
 */
export function decodeNativeBacklogDrag(data: string): LaneDragCard | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  const rows = (parsed as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) return null;
  const cards = rows
    .filter(isRow)
    .slice(0, MAX_ROWS)
    .map((row) => rowCard({ id: row.id, title: row.title.slice(0, MAX_TITLE) }));
  const lead = cards[0];
  if (!lead) return null;
  return cards.length > 1 ? { ...lead, group: cards } : lead;
}

/** Lights the lanes while a native drag from the Backlog window is over this window: its data can't be read until the drop. */
export function nativeBacklogPlaceholder(): LaneDragCard {
  return { ...rowCard({ id: 1, title: 'Backlog items' }), key: 'backlog:window', label: 'the backlog items' };
}
