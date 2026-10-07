import type { Emit } from '../ipc/emit';

/** The part of a BrowserWindow this needs, so tests can pass a plain EventEmitter. */
export interface VisibilityWindow {
  on(event: 'minimize' | 'restore' | 'hide' | 'show', listener: () => void): unknown;
  removeListener(event: 'minimize' | 'restore' | 'hide' | 'show', listener: () => void): unknown;
  isMinimized(): boolean;
  isVisible(): boolean;
}

/**
 * Tells the renderer when the main window is minimised or hidden and when it comes back (`app:window`,
 * AL-066), so it polls Azure DevOps only while the user can see the board. The page's own
 * `visibilityState` is not enough: it stays `visible` when a test harness or the OS keeps the
 * renderer awake. Returns a function that stops watching.
 */
export function watchWindowVisibility(window: VisibilityWindow, emit: Emit, now: () => number = Date.now): () => void {
  let last: boolean | undefined;
  const send = () => {
    const visible = window.isVisible() && !window.isMinimized();
    if (visible === last) return;
    last = visible;
    emit('app:window', { at: now(), visible });
  };
  const events = ['minimize', 'restore', 'hide', 'show'] as const;
  for (const event of events) window.on(event, send);
  return () => {
    for (const event of events) window.removeListener(event, send);
  };
}
