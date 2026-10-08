/** Native builds: focus moves with the platform's own rules, so there is nothing to put back. */
export function rememberFocus(): () => void {
  return () => {};
}
