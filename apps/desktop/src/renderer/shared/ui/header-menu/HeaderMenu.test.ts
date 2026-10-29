import { describe, expect, it } from 'vitest';
import { placeMenu } from './HeaderMenu';

const trigger = { x: 100, top: 400, bottom: 444, width: 200 };

describe('placeMenu', () => {
  it('hangs under the trigger at full height when the window has room', () => {
    expect(placeMenu(trigger, 1000)).toEqual({ top: 448, maxHeight: 360 });
  });

  it('shortens the menu to the room under the trigger', () => {
    const high = { ...trigger, top: 100, bottom: 144 };
    const placed = placeMenu(high, 400);
    expect(placed.top).toBe(148);
    expect(placed.maxHeight).toBe(400 - 144 - 4 - 8);
    expect(placed.bottom).toBeUndefined();
  });

  it('opens above the trigger when that has more room', () => {
    const placed = placeMenu(trigger, 480);
    expect(placed.top).toBeUndefined();
    expect(placed.bottom).toBe(480 - 400 + 4);
    expect(placed.maxHeight).toBe(360);
  });
});
