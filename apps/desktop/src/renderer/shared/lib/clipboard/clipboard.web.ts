/** Puts text on the clipboard through the browser API (Electron's renderer). Resolves false when it could not. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
