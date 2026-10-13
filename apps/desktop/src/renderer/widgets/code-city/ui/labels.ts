import type { CityBuilding, CityLayout } from '../model/layoutCity';
import { CHIP_HEIGHT, chipWidth, nudgeLabels, plotPair, type LabelBox } from '../model/cityData';
import type { Anchors } from './useSceneMetrics';

/** What a flat label chip says and where it sits. Pure: the scene turns anchors into these. */
export interface ChipLabel {
  key: string;
  kind: 'building' | 'rubble';
  /** The file the chip selects. */
  path: string;
  name: string;
  added: number;
  removed: number;
  tall: boolean;
  binary: boolean;
  deleted: boolean;
  x: number;
  y: number;
  /** px up from the anchor, from overlap nudging. */
  lift: number;
}

export interface DistrictLabel {
  key: string;
  text: string;
  color: string;
  x: number;
  y: number;
}

export interface LabelModel {
  chips: ChipLabel[];
  districts: DistrictLabel[];
  /** Lift of each building's label by path, so a pin can stay above it. */
  lifts: Record<string, number>;
}

const DISTRICT_LABEL_H = 16;

function chipText(b: CityBuilding, kind: ChipLabel['kind']): string {
  if (kind === 'rubble') return b.kind === 'deleted' ? `${b.name} deleted −${b.removed}` : `demolished −${b.removed}`;
  return b.slab ? `${b.name} binary` : `${b.name} +${b.added} −${b.removed}`;
}

/** Chips in reading order with their overlap nudge: the later label moves up by its height + 4, up to 3 passes. */
export function buildLabels(layout: CityLayout, anchors: Anchors): LabelModel {
  const districts: DistrictLabel[] = [];
  const fixed: { left: number; right: number; top: number; bottom: number }[] = [];
  layout.districts.forEach((district, index) => {
    const at = anchors.districts[district.key];
    if (!at) return;
    const pair = plotPair(index);
    districts.push({ key: district.key, text: district.label, color: pair.border, x: at.x, y: at.y });
    const w = district.label.length * 7.6 + 4;
    fixed.push({ left: at.x - w / 2, right: at.x + w / 2, top: at.y + 2, bottom: at.y + 2 + DISTRICT_LABEL_H });
  });

  const pending: (Omit<ChipLabel, 'lift'> & { w: number })[] = [];
  for (const b of layout.buildings) {
    if (b.kind !== 'deleted') {
      const at = anchors.buildings[b.path];
      if (at) {
        pending.push({ key: `b:${b.path}`, kind: 'building', path: b.path, name: b.name, added: b.added, removed: b.removed, tall: b.tall, binary: b.slab, deleted: false, x: at.x, y: at.y, w: chipWidth(chipText(b, 'building'), 2 + (b.tall ? 5 : 0)) });
      }
    }
    if (b.rubble) {
      const at = anchors.rubble[b.path];
      if (at) {
        pending.push({ key: `r:${b.path}`, kind: 'rubble', path: b.path, name: b.name, added: b.added, removed: b.removed, tall: false, binary: false, deleted: b.kind === 'deleted', x: at.x, y: at.y, w: chipWidth(chipText(b, 'rubble')) });
      }
    }
  }

  const boxes: LabelBox[] = pending.map((p) => ({ key: p.key, x: p.x, y: p.y, w: p.w, h: CHIP_HEIGHT }));
  const offsets = nudgeLabels(boxes, fixed);
  const chips: ChipLabel[] = pending.map(({ w: _w, ...rest }) => ({ ...rest, lift: offsets[rest.key] ?? 0 }));
  const lifts: Record<string, number> = {};
  for (const chip of chips) if (chip.kind === 'building' || chip.deleted) lifts[chip.path] = chip.lift;
  return { chips, districts, lifts };
}
