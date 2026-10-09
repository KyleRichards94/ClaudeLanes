import type { OutputRow } from './rows';

/**
 * Windowing for the output stream (AL-175, design §12 Performance). Rows have different heights
 * (a one-line tool row, a paragraph of prose), so each row's height is its measured height once it
 * has been drawn, and an estimate until then. Only the rows in and near the view are drawn, in normal
 * flow between two spacers whose heights stand in for the rows above and below; a measured height
 * only ever changes a spacer, so drawn rows never overlap.
 */

/** Pixels drawn above and below the view, so a fast wheel never shows a blank strip. */
export const OUTPUT_OVERSCAN_PX = 800;
/** Width assumed for prose before the first layout (and in tests). */
const FALLBACK_WIDTH = 900;
/** Average prose character width at 14 px Plus Jakarta Sans, for estimates. */
const CHAR_PX = 7.4;
const PROSE_LINE_PX = 22;
/** Vertical gap between rows (part of each row's height). */
export const OUTPUT_ROW_GAP = 10;

/** A first guess at a row's height, before it is measured. */
export function estimateRowHeight(row: OutputRow, width = FALLBACK_WIDTH): number {
  switch (row.type) {
    case 'tool':
      return 38 + OUTPUT_ROW_GAP;
    case 'system':
    case 'failed':
    case 'turn-end':
      return 18 + OUTPUT_ROW_GAP;
    case 'user': {
      const perLine = Math.max(Math.floor((width * 0.8) / CHAR_PX), 20);
      const lines = row.text.split('\n').reduce((sum, line) => sum + Math.max(Math.ceil(line.length / perLine), 1), 0);
      return 16 + 8 + lines * PROSE_LINE_PX + 16 + OUTPUT_ROW_GAP;
    }
    case 'prose':
    case 'streaming': {
      const perLine = Math.max(Math.floor(width / CHAR_PX), 20);
      const lines = row.text.split('\n').reduce((sum, line) => sum + Math.max(Math.ceil(line.length / perLine), 1), 0);
      return lines * PROSE_LINE_PX + OUTPUT_ROW_GAP;
    }
  }
}

/**
 * Top offset of every row, plus the total height at the end (`offsets[rows.length]`). Measured
 * heights win over estimates; linear in the number of rows (10,000 rows take well under a millisecond).
 */
export function rowOffsets(rows: readonly OutputRow[], measured: ReadonlyMap<string, number>, width?: number): Float64Array {
  const offsets = new Float64Array(rows.length + 1);
  let top = 0;
  for (let index = 0; index < rows.length; index++) {
    offsets[index] = top;
    const row = rows[index]!;
    top += measured.get(row.key) ?? estimateRowHeight(row, width);
  }
  offsets[rows.length] = top;
  return offsets;
}

/** The last index whose offset is at or above `y` (binary search over the sorted offsets). */
function indexAt(offsets: Float64Array, count: number, y: number): number {
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (offsets[mid]! <= y) low = mid;
    else high = mid - 1;
  }
  return Math.max(low, 0);
}

/** Rows to draw for a scroll position: `start` inclusive, `end` exclusive, with OUTPUT_OVERSCAN_PX either side. */
export function windowFor(offsets: Float64Array, count: number, scrollTop: number, viewport: number, overscan = OUTPUT_OVERSCAN_PX): { start: number; end: number } {
  if (count === 0) return { start: 0, end: 0 };
  const top = Math.max(scrollTop - overscan, 0);
  const bottom = scrollTop + viewport + overscan;
  const start = indexAt(offsets, count, top);
  let end = indexAt(offsets, count, bottom) + 1;
  if (end > count) end = count;
  return { start, end };
}
