import type { RefObject } from 'react';

/** A file the user pasted, dropped or picked (AL-259), read as base64. */
export interface PickedFile {
  name: string;
  mediaType: string;
  bytes: number;
  data: string;
}

/** Opens the OS file picker; resolves the files chosen, none when cancelled. Web-only; nothing elsewhere. */
export async function pickFiles(): Promise<PickedFile[]> {
  return [];
}

/**
 * Listens for files pasted into or dropped onto the element behind `ref`, calling `onFiles`.
 * Returns the function that stops listening. Web-only; a no-op elsewhere.
 */
export function listenForFiles(_ref: RefObject<unknown>, _onFiles: (files: PickedFile[]) => void): () => void {
  return () => undefined;
}
