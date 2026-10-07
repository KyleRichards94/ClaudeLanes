/**
 * Puts text on the system clipboard. Resolves false when it could not. The web build
 * (`clipboard.web.ts`) uses the browser clipboard; a native build would use a clipboard module.
 */
export async function copyText(_text: string): Promise<boolean> {
  return false;
}
