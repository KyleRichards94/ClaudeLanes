import { useEffect, useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react';
import { usePrefersReducedMotion } from '@/shared/lib';
import { faceColors } from '../model/cityData';

export interface BuildingProps {
  path: string;
  x: number;
  y: number;
  side: number;
  height: number;
  /** The author colour C. */
  color: string;
  label: string;
  selected: boolean;
  /** The roving tab stop: one building in the whole city has tabIndex 0. */
  tabStop: boolean;
  uncommitted?: boolean;
  slab?: boolean;
  /** A skeleton ghost: no role, not focusable, grey and pulsing. */
  ghost?: boolean;
  onSelect?: (path: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>, path: string) => void;
  onFocus?: (path: string) => void;
  onHover?: (path: string | null) => void;
}

type VarStyle = CSSProperties & Record<`--${string}`, string>;

/** How long a growing building keeps the `rising` class (handoff: 400 ms). */
const RISING_MS = 400;

/**
 * One file: a CSS 3D box. Children are in stacking order: shadow, s (front face), e (right face), top, win.
 * Heights that grow get the `rising` class for 400 ms so the faces animate up (not under reduced motion).
 */
export function Building({ path, x, y, side, height, color, label, selected, tabStop, uncommitted, slab, ghost, onSelect, onKeyDown, onFocus, onHover }: BuildingProps) {
  const reduced = usePrefersReducedMotion();
  const [seenHeight, setSeenHeight] = useState(height);
  const [rising, setRising] = useState(false);
  if (height !== seenHeight) {
    setSeenHeight(height);
    setRising(height > seenHeight && !reduced);
  }
  useEffect(() => {
    if (!rising) return;
    const timer = setTimeout(() => setRising(false), RISING_MS);
    return () => clearTimeout(timer);
  }, [rising, height]);

  const { c1, c2, c3 } = faceColors(color);
  const style: VarStyle = { left: x, top: y, width: side, height: side, '--h': `${height}px`, '--c1': c1, '--c2': c2, '--c3': c3 };
  const className = ['cc-b', rising && 'rising', uncommitted && 'uncommitted', slab && 'slab', ghost && 'cc-ghost'].filter(Boolean).join(' ');

  const faces = (
    <>
      <div className="shadow" />
      <div className="s" />
      <div className="e" />
      <div className="top" />
      <div className="win" />
    </>
  );

  if (ghost) {
    return (
      <div className={className} style={style} aria-hidden="true">
        {faces}
      </div>
    );
  }

  return (
    <div
      className={className}
      style={style}
      role="option"
      aria-selected={selected}
      aria-label={label}
      tabIndex={tabStop ? 0 : -1}
      data-path={path}
      onClick={(event: MouseEvent) => {
        event.stopPropagation();
        onSelect?.(path);
      }}
      onKeyDown={(event) => onKeyDown?.(event, path)}
      onFocus={() => onFocus?.(path)}
      onMouseEnter={() => onHover?.(path)}
      onMouseLeave={() => onHover?.(null)}
    >
      {faces}
    </div>
  );
}
