/**
 * Web: Escape anywhere in the window closes the popout (TB§5), wherever focus is (after a pointer
 * drop it is on the page, not in the popout). Listens in the capture phase, so the caller can still
 * see a keyboard drag that Escape is about to cancel. An Escape inside a menu or a modal dialog (the
 * Priority menu, "Send to lane") is theirs.
 */
export function onEscape(close: () => void): () => void {
  const listener = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    if (event.target instanceof Element && event.target.closest('[role="menu"], [aria-modal="true"]')) return;
    close();
  };
  window.addEventListener('keydown', listener, true);
  return () => window.removeEventListener('keydown', listener, true);
}
