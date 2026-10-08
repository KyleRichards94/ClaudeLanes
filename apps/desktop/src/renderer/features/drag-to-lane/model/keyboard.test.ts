import type { SensorContext } from '@dnd-kit/core';
import { describe, expect, it, vi } from 'vitest';
import { LANE_KEYBOARD_CODES, laneKeyboardCoordinates } from './keyboard';

function rect(left: number, top: number, width: number, height: number) {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

/** Implementing and Code review take the card (artboard 09); they are listed out of order on purpose. */
function context(over: string | null): SensorContext {
  const rects = new Map([
    ['lane:code-review', rect(500, 100, 200, 400)],
    ['lane:implementing', rect(280, 100, 200, 400)],
  ]);
  return {
    collisionRect: rect(1200, 800, 220, 120),
    droppableRects: rects,
    droppableContainers: { getEnabled: () => [...rects.keys()].map((id) => ({ id })) },
    over: over ? { id: over } : null,
  } as unknown as SensorContext;
}

function press(code: string, over: string | null) {
  const event = { code, preventDefault: vi.fn() } as unknown as KeyboardEvent;
  const result = laneKeyboardCoordinates(event, { active: 'pr:10571', currentCoordinates: { x: 1200, y: 800 }, context: context(over) });
  return { result, event };
}

describe('laneKeyboardCoordinates (AL-235, TB§7)', () => {
  it('from the team board, the first arrow goes to the first lane that takes the card, centred under its header', () => {
    expect(press('ArrowUp', null).result).toEqual({ x: 280 + (200 - 220) / 2, y: 156 });
    expect(press('ArrowRight', null).result).toEqual({ x: 270, y: 156 });
    // Left starts from the last one.
    expect(press('ArrowLeft', null).result).toEqual({ x: 490, y: 156 });
  });

  it('moves to the next or previous accepting lane, and stays put at either end', () => {
    expect(press('ArrowRight', 'lane:implementing').result).toEqual({ x: 490, y: 156 });
    expect(press('ArrowDown', 'lane:implementing').result).toEqual({ x: 490, y: 156 });
    expect(press('ArrowLeft', 'lane:code-review').result).toEqual({ x: 270, y: 156 });
    expect(press('ArrowRight', 'lane:code-review').result).toBeUndefined();
    expect(press('ArrowLeft', 'lane:implementing').result).toBeUndefined();
  });

  it('leaves other keys to the sensor and stops arrows scrolling the page', () => {
    expect(press('KeyA', null).result).toBeUndefined();
    expect(press('KeyA', null).event.preventDefault).not.toHaveBeenCalled();
    expect(press('ArrowRight', null).event.preventDefault).toHaveBeenCalled();
  });

  it('picks up with Space only (Enter opens the menu), drops with Space or Enter, cancels with Escape or Tab', () => {
    expect(LANE_KEYBOARD_CODES).toEqual({ start: ['Space'], cancel: ['Escape', 'Tab'], end: ['Space', 'Enter'] });
  });
});
