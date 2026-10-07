import type { Router } from '@/shared/routing';

/** `MouseEvent.button` values of a mouse's side buttons. */
const MOUSE_BACK = 3;
const MOUSE_FORWARD = 4;

/** Alt+← / Alt+→ leave text alone: there they belong to the field (word jumps on macOS, drafts). */
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

type HistoryActions = Pick<Router, 'back' | 'forward'>;

/**
 * Browser-style Back and Forward for the whole window: the mouse's side buttons, Alt+← and Alt+→,
 * and a keyboard's Browser Back / Forward keys. A handler that calls `preventDefault()` first keeps
 * the input for itself. Returns a function that removes the listeners.
 */
export function installHistoryInput(target: Window, history: HistoryActions): () => void {
  const onMouseUp = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    const go = event.button === MOUSE_BACK ? history.back : event.button === MOUSE_FORWARD ? history.forward : undefined;
    if (!go) return;
    // Chromium may also act on these buttons; the in-app history is the only one that should move.
    event.preventDefault();
    go();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat) return;
    const go = historyKey(event, history);
    if (!go) return;
    event.preventDefault();
    go();
  };

  target.addEventListener('mouseup', onMouseUp);
  target.addEventListener('keydown', onKeyDown);
  return () => {
    target.removeEventListener('mouseup', onMouseUp);
    target.removeEventListener('keydown', onKeyDown);
  };
}

function historyKey(event: KeyboardEvent, history: HistoryActions): (() => void) | undefined {
  if (event.key === 'BrowserBack') return history.back;
  if (event.key === 'BrowserForward') return history.forward;

  const altOnly = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
  if (!altOnly || isEditable(event.target)) return undefined;
  if (event.key === 'ArrowLeft') return history.back;
  if (event.key === 'ArrowRight') return history.forward;
  return undefined;
}

function isEditable(target: EventTarget | null): boolean {
  const element = target as Partial<Element> | null;
  return typeof element?.closest === 'function' && element.closest(EDITABLE) !== null;
}
