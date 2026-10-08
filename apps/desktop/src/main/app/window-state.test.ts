import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_WINDOW_SIZE,
  MIN_WINDOW_SIZE,
  currentWindowState,
  readWindowState,
  windowPlacement,
  windowStateFile,
  writeWindowState,
  type WindowState,
} from './window-state';

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
const SECOND = { x: 1920, y: 0, width: 2560, height: 1400 };

function saved(bounds: WindowState['bounds'], maximized = false): WindowState {
  return { version: 1, bounds, maximized };
}

describe('windowPlacement (AL-213)', () => {
  it('opens at the default size, centred, the first time', () => {
    expect(windowPlacement(undefined, [PRIMARY])).toEqual({ ...DEFAULT_WINDOW_SIZE, maximized: false });
  });

  it('fits the default size to a small screen without going under the minimum', () => {
    expect(windowPlacement(undefined, [{ x: 0, y: 0, width: 1280, height: 680 }])).toEqual({ width: 1280, height: MIN_WINDOW_SIZE.height, maximized: false });
  });

  it('restores the saved size and position, on any screen', () => {
    expect(windowPlacement(saved({ x: 100, y: 50, width: 1500, height: 900 }), [PRIMARY])).toEqual({ x: 100, y: 50, width: 1500, height: 900, maximized: false });
    expect(windowPlacement(saved({ x: 2000, y: 80, width: 1600, height: 1000 }, true), [PRIMARY, SECOND])).toEqual({
      x: 2000,
      y: 80,
      width: 1600,
      height: 1000,
      maximized: true,
    });
  });

  it('opens centred when the saved spot is off every screen (a monitor was unplugged)', () => {
    expect(windowPlacement(saved({ x: 2000, y: 80, width: 1600, height: 1000 }, true), [PRIMARY])).toEqual({ width: 1600, height: 1000, maximized: true });
  });

  it('keeps a window whose title bar is partly on screen, and shrinks one larger than its screen', () => {
    expect(windowPlacement(saved({ x: -1000, y: 10, width: 1200, height: 800 }), [PRIMARY])).toMatchObject({ x: -1000, y: 10 });
    expect(windowPlacement(saved({ x: 0, y: 0, width: 3000, height: 2000 }), [PRIMARY])).toEqual({ x: 0, y: 0, width: 1920, height: 1040, maximized: false });
  });

  it('never opens under the minimum size', () => {
    expect(windowPlacement(saved({ x: 10, y: 10, width: 400, height: 300 }), [PRIMARY])).toMatchObject(MIN_WINDOW_SIZE);
  });
});

describe('window state file (AL-213)', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('round-trips through window-state.json in the app data folder', () => {
    dir = mkdtempSync(join(tmpdir(), 'agent-lanes-window-state-'));
    const file = windowStateFile(dir);
    const state = currentWindowState({ getNormalBounds: () => ({ x: 10.4, y: 20, width: 1500, height: 900.6 }), isMaximized: () => true });
    expect(state).toEqual({ version: 1, bounds: { x: 10, y: 20, width: 1500, height: 901 }, maximized: true });

    expect(writeWindowState(file, state)).toBe(true);
    expect(readWindowState(file)).toEqual(state);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(state);
  });

  it('reads nothing from a missing, damaged or unknown file, so the window opens centred', () => {
    dir = mkdtempSync(join(tmpdir(), 'agent-lanes-window-state-'));
    const file = windowStateFile(dir);
    expect(readWindowState(file)).toBeUndefined();
    writeFileSync(file, '{ not json');
    expect(readWindowState(file)).toBeUndefined();
    writeFileSync(file, JSON.stringify({ version: 2, bounds: { x: 0, y: 0, width: 1, height: 1 }, maximized: false }));
    expect(readWindowState(file)).toBeUndefined();
  });

  it('reports a write it could not make instead of throwing', () => {
    dir = mkdtempSync(join(tmpdir(), 'agent-lanes-window-state-'));
    const warnings: string[] = [];
    // A file where the folder should be: the folder can't be created.
    const file = join(dir, 'blocked');
    writeFileSync(file, 'a file, not a folder');
    const blocked = windowStateFile(join(file, 'nested'));
    expect(writeWindowState(blocked, saved({ x: 0, y: 0, width: 1200, height: 800 }), (message) => warnings.push(message))).toBe(false);
    expect(warnings).toHaveLength(1);
  });
});
