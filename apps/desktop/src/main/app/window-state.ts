import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

/**
 * The main window's size, position and maximised state, kept between launches (AL-213) in an
 * app-written `<userData>/window-state.json` (R2, R5: no user-edited config). The window opens where
 * it was left when that spot is still on a screen, and centred at the default size otherwise.
 */

export const WINDOW_STATE_FILE_NAME = 'window-state.json';
export const DEFAULT_WINDOW_SIZE = { width: 1440, height: 960 } as const;
export const MIN_WINDOW_SIZE = { width: 1100, height: 720 } as const;
/** How much of the window must still be on a screen for it to open there: enough to grab and move it. */
const MIN_VISIBLE = { width: 120, height: 48 } as const;

const RectSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type Rect = z.infer<typeof RectSchema>;

export const WindowStateSchema = z.object({
  version: z.literal(1),
  /** The normal (not maximised) bounds, so un-maximising returns to them. */
  bounds: RectSchema,
  maximized: z.boolean(),
});
export type WindowState = z.infer<typeof WindowStateSchema>;

/** Where the window opens. No `x`/`y` means centred on the primary screen. */
export interface WindowPlacement {
  x?: number;
  y?: number;
  width: number;
  height: number;
  maximized: boolean;
}

export function windowStateFile(appDataDir: string): string {
  return join(appDataDir, WINDOW_STATE_FILE_NAME);
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y),
  };
}

function fitSize(width: number, height: number, area: Rect | undefined): { width: number; height: number } {
  const maxWidth = area ? Math.max(MIN_WINDOW_SIZE.width, area.width) : Number.POSITIVE_INFINITY;
  const maxHeight = area ? Math.max(MIN_WINDOW_SIZE.height, area.height) : Number.POSITIVE_INFINITY;
  return {
    width: Math.min(Math.max(width, MIN_WINDOW_SIZE.width), maxWidth),
    height: Math.min(Math.max(height, MIN_WINDOW_SIZE.height), maxHeight),
  };
}

/**
 * Where to open the window, given what was saved and the screens' work areas (primary first). A saved
 * window whose title bar strip is off every screen (a monitor was unplugged) opens centred instead.
 */
export function windowPlacement(saved: WindowState | undefined, workAreas: readonly Rect[]): WindowPlacement {
  const primary = workAreas[0];
  if (!saved) return { ...fitSize(DEFAULT_WINDOW_SIZE.width, DEFAULT_WINDOW_SIZE.height, primary), maximized: false };

  const { bounds } = saved;
  const titleBar: Rect = { x: bounds.x, y: bounds.y, width: bounds.width, height: Math.min(bounds.height, MIN_VISIBLE.height) };
  const screen = workAreas.find((area) => {
    const seen = overlap(titleBar, area);
    return seen.width >= MIN_VISIBLE.width && seen.height >= MIN_VISIBLE.height / 2;
  });
  if (!screen) return { ...fitSize(bounds.width, bounds.height, primary), maximized: saved.maximized };

  const size = fitSize(bounds.width, bounds.height, screen);
  return { x: bounds.x, y: bounds.y, ...size, maximized: saved.maximized };
}

/** The saved state, or undefined when there is none or it can't be read (the window then opens centred). */
export function readWindowState(file: string): WindowState | undefined {
  try {
    const parsed = WindowStateSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** Writes the state through a temporary file, so a crash mid-write never leaves half a file. Never throws. */
export function writeWindowState(file: string, state: WindowState, warn: (message: string) => void = () => undefined): boolean {
  const temporary = `${file}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(temporary, file);
    return true;
  } catch (cause) {
    warn(`The window size and position could not be saved: ${cause instanceof Error ? cause.message : String(cause)}`);
    return false;
  }
}

/** The part of a BrowserWindow this needs, so tests can pass a plain object. */
export interface StatefulWindow {
  getNormalBounds(): Rect;
  isMaximized(): boolean;
}

export function currentWindowState(window: StatefulWindow): WindowState {
  const bounds = window.getNormalBounds();
  return {
    version: 1,
    bounds: { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) },
    maximized: window.isMaximized(),
  };
}
