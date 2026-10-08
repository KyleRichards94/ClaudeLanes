/**
 * The collapsed agent board: once the page has scrolled past the agent lanes (down to the team
 * board), the lanes fold into a strip pinned under the header, one cell per lane with its count and
 * its cards' ids. Pure logic for BoardPage and AgentBoardStrip.
 */

/** Where the lanes and the pinned header are, as the board's ScrollView reports them. */
export interface BoardScrollMetrics {
  /** How far the board has scrolled, in px. */
  scrollY: number;
  /** The lanes' bottom edge in the scrolled content (layout y + height); null until measured. */
  lanesBottom: number | null;
  /** The pinned header's bottom edge from the top of the scroll area (its sticky offset + height); null until measured. */
  headerBottom: number | null;
}

/** How much of the lanes may still show below the header when they fold: about the strip's height, which covers it. */
export const COLLAPSE_MARGIN_PX = 96;

/**
 * Collapsed once the lanes have scrolled (almost) entirely under the pinned header: less than
 * {@link COLLAPSE_MARGIN_PX} of them is left below it, under where the strip appears. The strip floats
 * over the content, so showing it moves nothing and the result can't flip back and forth on its own.
 * A lane peeking out behind the strip still takes drops, but a strip cell is the smaller target under
 * the pointer and wins (DragToLaneProvider).
 */
export function isAgentBoardCollapsed({ scrollY, lanesBottom, headerBottom }: BoardScrollMetrics): boolean {
  if (lanesBottom === null || headerBottom === null || scrollY <= 0) return false;
  return lanesBottom - scrollY - headerBottom < COLLAPSE_MARGIN_PX;
}

/** Card chips a strip cell shows before "+N". */
export const STRIP_MAX_CHIPS = 3;

/** One lane's cell in the strip. */
export interface StripCellView {
  /** Ticket ids for the chips, oldest first, at most `max`. */
  chips: readonly string[];
  /** Cards left out, for "+2"; 0 when all fit. */
  overflow: number;
  /** "+2", or null. */
  overflowLabel: string | null;
}

export function stripCell(ids: readonly string[], max: number = STRIP_MAX_CHIPS): StripCellView {
  const chips = ids.slice(0, Math.max(0, max));
  const overflow = ids.length - chips.length;
  return { chips, overflow, overflowLabel: overflow > 0 ? `+${overflow}` : null };
}

/** A card's chip: the work item id (`#71273`) for an ADO ticket, else the ticket's own id. */
export function stripChipLabel(ticket: { id: string; ado: { workItemId: number } | null }): string {
  return ticket.ado ? `#${ticket.ado.workItemId}` : ticket.id;
}
