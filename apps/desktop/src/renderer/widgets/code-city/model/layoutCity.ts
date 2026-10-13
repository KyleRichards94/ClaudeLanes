import type { ChangeKind, ChangedFile } from '@agent-lanes/contracts';

/**
 * The Code City layout (handoff "City layout algorithm", AL-280): a pure, deterministic function from the changed
 * files to plane-space coordinates in px. The same files always give the same city, so buildings never jump
 * between renders. No DOM, no React.
 */

export const MAX_BUILDINGS = 40;
export const PLANE_W = 880;
export const GUTTER = 30;
export const PAD = 30;
export const LABEL = 40;
export const ROW_W = 300;
/** Gap between a building and its rubble tile, and between footprints in a row. */
export const RUBBLE_GAP = 12;
export const FOOTPRINT_GAP = 30;
/** Height of a binary file's slab. */
export const SLAB_HEIGHT = 10;
/** A changed file that adds no lines still stands this tall, so it can be seen and clicked. */
export const MIN_HEIGHT = 14;
export const MAX_HEIGHT = 240;
/** Above this many added lines a building is capped and its label carries a "tall" badge. */
export const TALL_LINES = 180;
/** The grey "{n} more files" plot. */
export const OVERFLOW_PLOT = { w: 200, d: 120 } as const;

export interface CityRubble {
  x: number;
  y: number;
  w: number;
  d: number;
}

export interface CityBuilding {
  path: string;
  /** The file's base name. */
  name: string;
  x: number;
  y: number;
  /** Footprint edge. 0 for a deleted file, which has rubble only. */
  side: number;
  /** 0 for a deleted file; {@link SLAB_HEIGHT} for a binary file. */
  height: number;
  rubble?: CityRubble;
  kind: ChangeKind;
  districtKey: string;
  /** Index into `districts`. */
  districtIndex: number;
  added: number;
  removed: number;
  /** A binary file: a flat grey slab. */
  slab: boolean;
  /** Over {@link TALL_LINES} added lines: the height is capped. */
  tall: boolean;
}

export interface CityDistrict {
  key: string;
  label: string;
  x: number;
  y: number;
  w: number;
  d: number;
}

export interface CityLayout {
  width: number;
  depth: number;
  districts: CityDistrict[];
  buildings: CityBuilding[];
  /** Files beyond the first {@link MAX_BUILDINGS}. */
  overflow: number;
  /** The "{n} more files" plot, when `overflow > 0`. */
  overflowPlot: { x: number; y: number; w: number; d: number } | null;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const round10 = (value: number): number => Math.round(value / 10) * 10;

export function districtKey(path: string, commonPrefix: string): string {
  const dir = path.slice(commonPrefix.length).split('/').slice(0, -1);
  return dir.length === 0 ? '(root)' : dir.slice(0, 2).join('/');
}

/** Footprint edge from a file's total changed lines. */
export const side = (total: number): number => clamp(round10(40 + 8 * Math.log2(1 + total)), 56, 120);

/** Height from added lines; 0 for none. */
export const height = (added: number): number => (added === 0 ? 0 : clamp(Math.round(added * 1.35), MIN_HEIGHT, MAX_HEIGHT));

/** The red rubble tile for removed lines. */
export const rubble = (removed: number): { w: number; d: number } => {
  const w = clamp(Math.round(30 + removed * 2.2), 30, 160);
  return { w, d: Math.round(w * 0.75) };
};

export function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function districtLabel(key: string): string {
  return key.split('/').join(' / ');
}

/** The longest directory prefix shared by every path, with its trailing slash ('' when there is none). */
export function commonDirPrefix(paths: readonly string[]): string {
  if (paths.length === 0) return '';
  let shared = (paths[0] ?? '').split('/').slice(0, -1);
  for (const path of paths) {
    const dirs = path.split('/').slice(0, -1);
    let i = 0;
    while (i < shared.length && i < dirs.length && shared[i] === dirs[i]) i++;
    shared = shared.slice(0, i);
    if (shared.length === 0) return '';
  }
  return `${shared.join('/')}/`;
}

type LayoutFile = Pick<ChangedFile, 'path' | 'kind' | 'added' | 'removed'>;

interface Item {
  file: LayoutFile;
  key: string;
  /** Footprint of the item: the building plus its rubble. */
  w: number;
  d: number;
}

function itemFor(file: LayoutFile, key: string): Item {
  const sideLength = side(file.added + file.removed);
  if (file.kind === 'deleted') {
    const tile = rubble(file.removed);
    return { file, key, w: tile.w, d: tile.d };
  }
  if (file.removed > 0) {
    const tile = rubble(file.removed);
    return { file, key, w: sideLength + RUBBLE_GAP + tile.w, d: Math.max(sideLength, tile.d) };
  }
  return { file, key, w: sideLength, d: sideLength };
}

const byPath = (a: LayoutFile, b: LayoutFile): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

let cache: { key: string; layout: CityLayout } | null = null;

/** Lays the files out as a city. Memoised on a hash of `path:added:removed` (and kind), so equal input is free. */
export function layoutCity(files: readonly LayoutFile[]): CityLayout {
  const cacheKey = files
    .map((f) => `${f.path}:${f.added}:${f.removed}:${f.kind}`)
    .sort()
    .join('|');
  if (cache?.key === cacheKey) return cache.layout;
  const layout = compute(files);
  cache = { key: cacheKey, layout };
  return layout;
}

function compute(input: readonly LayoutFile[]): CityLayout {
  if (input.length === 0) {
    return { width: 0, depth: 0, districts: [], buildings: [], overflow: 0, overflowPlot: null };
  }

  // 1 + 2. Common prefix, then group by district.
  const prefix = commonDirPrefix(input.map((f) => f.path));
  const groups = new Map<string, LayoutFile[]>();
  for (const file of input) {
    const key = districtKey(file.path, prefix);
    const group = groups.get(key);
    if (group) group.push(file);
    else groups.set(key, [file]);
  }

  // 3. Districts by total lines (desc) then name; files by added + removed (desc) then path.
  const total = (f: LayoutFile) => f.added + f.removed;
  const ordered = [...groups.entries()]
    .map(([key, group]) => ({ key, files: [...group].sort((a, b) => total(b) - total(a) || byPath(a, b)), lines: group.reduce((n, f) => n + total(f), 0) }))
    .sort((a, b) => b.lines - a.lines || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  // 4. Cap at 40 files overall in that order.
  let budget = MAX_BUILDINGS;
  const kept: { key: string; files: LayoutFile[] }[] = [];
  for (const district of ordered) {
    if (budget <= 0) break;
    const take = district.files.slice(0, budget);
    budget -= take.length;
    kept.push({ key: district.key, files: take });
  }
  const overflow = Math.max(0, input.length - MAX_BUILDINGS);

  // 5 + 6. Rows of footprints inside each district, then the plate around them.
  interface Plate {
    key: string;
    w: number;
    d: number;
    placed: { item: Item; x: number; y: number }[];
  }
  const plates: Plate[] = kept.map(({ key, files }) => {
    const placed: Plate['placed'] = [];
    let cx = 0;
    let cy = 0;
    let rowD = 0;
    let usedW = 0;
    for (const file of files) {
      const item = itemFor(file, key);
      if (cx > 0 && cx + item.w > ROW_W) {
        cy += rowD + FOOTPRINT_GAP;
        cx = 0;
        rowD = 0;
      }
      placed.push({ item, x: cx, y: cy });
      cx += item.w + FOOTPRINT_GAP;
      rowD = Math.max(rowD, item.d);
      usedW = Math.max(usedW, cx - FOOTPRINT_GAP);
    }
    return { key, w: usedW + 2 * PAD, d: cy + rowD + PAD + LABEL, placed };
  });

  // 7. Shelf-pack plates (and the overflow plot last) left to right in rows no wider than PLANE_W.
  const slots: { w: number; d: number }[] = plates.map((p) => ({ w: p.w, d: p.d }));
  if (overflow > 0) slots.push({ ...OVERFLOW_PLOT });
  const positions: { x: number; y: number }[] = [];
  let sx = 0;
  let sy = 0;
  let shelfD = 0;
  let width = 0;
  for (const slot of slots) {
    if (sx > 0 && sx + slot.w > PLANE_W) {
      sy += shelfD + GUTTER;
      sx = 0;
      shelfD = 0;
    }
    positions.push({ x: sx, y: sy });
    sx += slot.w + GUTTER;
    shelfD = Math.max(shelfD, slot.d);
    width = Math.max(width, sx - GUTTER);
  }
  const depth = sy + shelfD;

  const districts: CityDistrict[] = [];
  const buildings: CityBuilding[] = [];
  plates.forEach((plate, districtIndex) => {
    const origin = positions[districtIndex] ?? { x: 0, y: 0 };
    districts.push({ key: plate.key, label: districtLabel(plate.key), x: origin.x, y: origin.y, w: plate.w, d: plate.d });
    for (const { item, x, y } of plate.placed) {
      const { file } = item;
      const bx = origin.x + PAD + x;
      const by = origin.y + PAD + y;
      const sideLength = side(file.added + file.removed);
      const deleted = file.kind === 'deleted';
      const slab = file.kind === 'binary';
      const tile = file.removed > 0 || deleted ? rubble(file.removed) : null;
      const buildingHeight = deleted ? 0 : slab ? SLAB_HEIGHT : Math.max(MIN_HEIGHT, height(file.added));
      buildings.push({
        path: file.path,
        name: fileName(file.path),
        x: bx,
        y: by,
        side: deleted ? 0 : sideLength,
        height: buildingHeight,
        ...(tile
          ? { rubble: { x: deleted ? bx : bx + sideLength + RUBBLE_GAP, y: by, w: tile.w, d: tile.d } }
          : {}),
        kind: file.kind,
        districtKey: plate.key,
        districtIndex,
        added: file.added,
        removed: file.removed,
        slab,
        tall: file.added > TALL_LINES,
      });
    }
  });

  const lastSlot = positions[positions.length - 1];
  const overflowPlot = overflow > 0 && lastSlot ? { x: lastSlot.x, y: lastSlot.y, ...OVERFLOW_PLOT } : null;
  return { width, depth, districts, buildings, overflow, overflowPlot };
}
