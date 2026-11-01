import type { CSSProperties } from 'react';
import { decoSeed } from '../model/cityData';
import { GUTTER, type CityLayout } from '../model/layoutCity';

type VarStyle = CSSProperties & Record<`--${string}`, string>;

interface Spot {
  key: string;
  x: number;
  y: number;
  kind: number;
  scale: number;
  delay: number;
}

/** How far a tree stands in from a plot's corner: inside the 30 px pad, clear of the buildings. */
const CORNER_INSET = 16;

/**
 * Where the trees go: two corners of each plot and one spot in the gutter to its right, picked from the plot's key so
 * the city never rearranges itself between renders.
 */
function spotsFor(layout: CityLayout): Spot[] {
  const spots: Spot[] = [];
  for (const d of layout.districts) {
    const seed = decoSeed(d.key);
    const corners = [
      [d.x + CORNER_INSET, d.y + CORNER_INSET],
      [d.x + d.w - CORNER_INSET, d.y + CORNER_INSET],
      [d.x + CORNER_INSET, d.y + d.d - CORNER_INSET],
      [d.x + d.w - CORNER_INSET, d.y + d.d - CORNER_INSET],
    ] as const;
    const first = seed % 4;
    const second = (first + 1 + ((seed >>> 4) % 3)) % 4;
    const gutter: [number, number] = [d.x + d.w + GUTTER / 2, d.y + d.d * (0.3 + ((seed >>> 8) % 5) / 10)];
    const picks: (readonly [number, number])[] = [corners[first] ?? corners[0], corners[second] ?? corners[3]];
    if (gutter[0] < layout.width + GUTTER) picks.push(gutter);
    picks.forEach(([x, y], index) => {
      const s = decoSeed(`${d.key}:${index}`);
      spots.push({ key: `${d.key}:${index}`, x, y, kind: s % 4, scale: 1.25 + ((s >>> 3) % 5) / 10, delay: (s >>> 6) % 40 / 10 });
    });
  }
  return spots;
}

/** Trees, a pine, a shrub and a flowering tree, 30 × 44 and standing on their bottom middle. */
function TreeArt({ kind }: { kind: number }) {
  switch (kind) {
    case 1:
      return (
        <g className="cc-sway">
          <rect x="13.5" y="34" width="3" height="10" rx="1" fill="#6E4B2E" />
          <path d="M15 4 L25 22 H5 Z" fill="#3E7B45" />
          <path d="M15 12 L27 32 H3 Z" fill="#4C8F4F" />
          <path d="M15 20 L26 37 H4 Z" fill="#5AA05A" />
        </g>
      );
    case 2:
      return (
        <g className="cc-sway">
          <ellipse cx="15" cy="37" rx="12" ry="7" fill="#4F8C3D" />
          <ellipse cx="10" cy="35" rx="7" ry="5.5" fill="#64A34E" />
          <ellipse cx="20" cy="34" rx="6" ry="5" fill="#76B35C" />
        </g>
      );
    case 3:
      return (
        <g className="cc-sway">
          <rect x="13.5" y="26" width="3" height="18" rx="1" fill="#7A5634" />
          <circle cx="15" cy="17" r="11" fill="#5E9E48" />
          <circle cx="9" cy="21" r="6.5" fill="#4F8C3D" />
          <circle cx="21" cy="20" r="7" fill="#6BAA52" />
          <circle cx="11" cy="13" r="1.6" fill="#F7C1D9" />
          <circle cx="18" cy="11" r="1.6" fill="#FFE08A" />
          <circle cx="20" cy="19" r="1.6" fill="#F7C1D9" />
          <circle cx="10" cy="22" r="1.6" fill="#FFE08A" />
        </g>
      );
    default:
      return (
        <g className="cc-sway">
          <rect x="13.5" y="26" width="3" height="18" rx="1" fill="#7A5634" />
          <circle cx="15" cy="17" r="11" fill="#5E9E48" />
          <circle cx="9" cy="22" r="7" fill="#4F8C3D" />
          <circle cx="21" cy="21" r="7.5" fill="#6BAA52" />
          <circle cx="12" cy="13" r="4" fill="#8CC46C" opacity="0.8" />
        </g>
      );
  }
}

/** The theme's scenery on the plane: trees and shrubs in Solarpunk, nothing in the other themes (code-city.css). */
export function CityDecor({ layout }: { layout: CityLayout }) {
  const spots = spotsFor(layout);
  return (
    <div className="cc-deco cc-garden" aria-hidden="true">
      {spots.map((spot) => {
        const style: VarStyle = { left: spot.x, top: spot.y, '--s': String(spot.scale), '--d': `${spot.delay}s` };
        return (
          <span key={spot.key} className="cc-tree" style={style}>
            <svg viewBox="0 0 30 44" width="30" height="44">
              <TreeArt kind={spot.kind} />
            </svg>
          </span>
        );
      })}
    </div>
  );
}

/** How many drops fall across the scene in cyberpunk. */
const DROPS = 85;

/** How far a drop falls in one loop, in vh (from 12vh above the scene to 105vh). */
const FALL_VH = 117;

/**
 * Cyberpunk's rain, behind the city: thin streaks of much the same size, all leaning with one wind and falling along
 * their lean. Position, length, brightness, speed and phase come from a seed, so nothing jumps or lines up. Hidden in
 * the other themes.
 */
export function CityRain() {
  const drops = Array.from({ length: DROPS }, (_, index) => {
    const s = decoSeed(`rain:${index}`);
    const tilt = 6.5 + ((s >>> 14) % 3) / 2;
    const style: VarStyle = {
      left: `${-2 + ((s >>> 4) % 1120) / 10}%`,
      '--len': `${18 + ((s >>> 8) % 11)}px`,
      '--w': '1px',
      '--a': String(0.24 + ((s >>> 12) % 11) / 100),
      '--tilt': `${tilt}deg`,
      '--drift': `${(-FALL_VH * Math.tan((tilt * Math.PI) / 180)).toFixed(2)}vh`,
      '--dur': `${0.9 + ((s >>> 20) % 41) / 100}s`,
      '--phase': `-${((s >>> 23) % 130) / 100}s`,
    };
    return <i key={index} className="cc-drop" style={style} />;
  });
  return (
    <div className="cc-rain" aria-hidden="true">
      {drops}
    </div>
  );
}
