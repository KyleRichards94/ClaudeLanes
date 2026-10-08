/** Web: remembers what had focus when the popout opened (the Backlog button); the returned call puts it back. */
export function rememberFocus(): () => void {
  const before = document.activeElement;
  return () => {
    if (before instanceof HTMLElement && before.isConnected) before.focus();
  };
}
