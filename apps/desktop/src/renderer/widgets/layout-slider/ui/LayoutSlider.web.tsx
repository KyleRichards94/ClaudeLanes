import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { color as palette, font } from '@agent-lanes/tokens';
import { Icon } from '@agent-lanes/ui';
import { usePrefersReducedMotion } from '@/shared/lib';
import type { TicketLayout } from '@/shared/model';
import {
  DRAG_THRESHOLD,
  SEGMENT_WIDTH,
  SLIDER_HEIGHT,
  SLIDER_INSET,
  SLIDER_OPTIONS,
  SLIDER_WIDTH,
  dragOffset,
  snapLayout,
  thumbOffsetFor,
} from '../lib/slider';
import type { LayoutSliderProps } from './LayoutSlider';

const ACTIVE = '#4A3BB0';
const INACTIVE = '#475569';

const trackStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flex: 'none',
  boxSizing: 'border-box',
  width: SLIDER_WIDTH,
  height: SLIDER_HEIGHT,
  padding: SLIDER_INSET,
  borderRadius: 12,
  background: '#EEF2F7',
  touchAction: 'none',
  userSelect: 'none',
};

const thumbStyle: CSSProperties = {
  position: 'absolute',
  top: SLIDER_INSET,
  left: SLIDER_INSET,
  width: SEGMENT_WIDTH,
  height: SLIDER_HEIGHT - 2 * SLIDER_INSET,
  borderRadius: 9,
  background: palette.surface,
  boxShadow: '0 1px 2px rgba(15,27,45,.08), 0 2px 6px rgba(15,27,45,.06)',
  willChange: 'transform',
  pointerEvents: 'none',
};

const segmentStyle: CSSProperties = {
  position: 'relative',
  display: 'flex',
  flex: 'none',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  boxSizing: 'border-box',
  width: SEGMENT_WIDTH,
  height: SLIDER_HEIGHT - 2 * SLIDER_INSET,
  margin: 0,
  padding: 0,
  border: 0,
  borderRadius: 9,
  background: 'transparent',
  cursor: 'pointer',
  fontFamily: font.sans,
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1,
  whiteSpace: 'nowrap',
};

/**
 * The ticket layout slider (AL-275, handoff "Layout slider"): a 260 x 40 track with two segments, Flight deck
 * and Code city, and a white thumb that slides under the active one (`transform`, 220 ms; instant under
 * reduced motion). A `radiogroup` of two `radio`s with a roving tab stop; Left and Right (and Home, End)
 * move the selection. Click a segment, or drag the thumb: on release it snaps to the nearer side.
 */
export function LayoutSlider({ value, onChange }: LayoutSliderProps) {
  const reduced = usePrefersReducedMotion();
  const segments = useRef<(HTMLButtonElement | null)[]>([]);
  // While dragging, the thumb follows the pointer instead of the value.
  const [dragging, setDragging] = useState<number | null>(null);
  const press = useRef<{ x: number; start: number; moved: boolean } | null>(null);
  // A drag ends in a click on whatever is under the pointer; that click must not also select.
  const swallowClick = useRef(false);

  const offset = dragging ?? thumbOffsetFor(value);
  const shown: TicketLayout = dragging === null ? value : snapLayout(dragging);

  const choose = (layout: TicketLayout) => {
    if (layout !== value) onChange(layout);
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    press.current = { x: event.clientX, start: thumbOffsetFor(value), moved: false };
    swallowClick.current = false;
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = press.current;
    if (!current) return;
    const delta = event.clientX - current.x;
    if (!current.moved && Math.abs(delta) < DRAG_THRESHOLD) return;
    if (!current.moved) {
      // Captured only once it is a drag: a plain press must still click the segment under it.
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // No capture (a test DOM): the pointer events still reach the track while over it.
      }
    }
    current.moved = true;
    setDragging(dragOffset(current.start, delta));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const current = press.current;
    press.current = null;
    if (!current?.moved) return;
    swallowClick.current = true;
    const released = dragOffset(current.start, event.clientX - current.x);
    setDragging(null);
    choose(snapLayout(released));
  };

  const onPointerCancel = () => {
    press.current = null;
    setDragging(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const target =
      event.key === 'ArrowLeft' || event.key === 'ArrowUp' || event.key === 'Home'
        ? 0
        : event.key === 'ArrowRight' || event.key === 'ArrowDown' || event.key === 'End'
          ? SLIDER_OPTIONS.length - 1
          : null;
    if (target === null) return;
    event.preventDefault();
    const option = SLIDER_OPTIONS[target];
    if (!option) return;
    choose(option.value);
    segments.current[target]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Ticket layout"
      data-testid="layout-slider"
      style={trackStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div
        aria-hidden
        data-testid="layout-slider-thumb"
        style={{
          ...thumbStyle,
          transform: `translateX(${offset}px)`,
          transition: dragging !== null || reduced ? 'none' : 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      />
      {SLIDER_OPTIONS.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              segments.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            data-testid={`layout-slider-${option.value}`}
            style={{ ...segmentStyle, color: option.value === shown ? ACTIVE : INACTIVE }}
            onClick={() => {
              if (swallowClick.current) {
                swallowClick.current = false;
                return;
              }
              choose(option.value);
            }}
            onKeyDown={onKeyDown}
          >
            <Icon name={option.icon} size={16} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
