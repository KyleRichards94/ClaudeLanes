/** Native builds have no Escape key to listen for; the close button closes the popout. */
export function onEscape(_close: () => void): () => void {
  return () => {};
}
