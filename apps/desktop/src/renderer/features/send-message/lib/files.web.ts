import type { RefObject } from 'react';
import type { PickedFile } from './files';

export type { PickedFile } from './files';

/** Reads a File as base64 without the data-URL prefix. */
export async function readFile(file: File): Promise<PickedFile> {
  const buffer = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return { name: file.name || `pasted-${Date.now()}.png`, mediaType: file.type || 'application/octet-stream', bytes: file.size, data: btoa(binary) };
}

/** Opens the OS file picker through a hidden input; resolves the files chosen. */
export function pickFiles(): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,.md,.json,.xml,.cs,.vb,.ts,.tsx,.js,.razor,.sql,.ps1,.yml,.yaml,.csv';
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])];
      input.remove();
      void Promise.all(files.map(readFile)).then(resolve);
    });
    input.addEventListener('cancel', () => {
      input.remove();
      resolve([]);
    });
    document.body.append(input);
    input.click();
  });
}

/** Paste and drop on the element behind `ref` (a react-native-web View gives its DOM node). */
export function listenForFiles(ref: RefObject<unknown>, onFiles: (files: PickedFile[]) => void): () => void {
  const node = ref.current as HTMLElement | null;
  if (!node || typeof node.addEventListener !== 'function') return () => undefined;
  const handle = (files: File[]) => {
    if (files.length === 0) return;
    void Promise.all(files.map(readFile)).then(onFiles);
  };
  const onPaste = (event: ClipboardEvent) => {
    const files = [...(event.clipboardData?.files ?? [])];
    if (files.length === 0) return;
    event.preventDefault();
    handle(files);
  };
  const onDrop = (event: DragEvent) => {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (files.length === 0) return;
    event.preventDefault();
    handle(files);
  };
  const onDragOver = (event: DragEvent) => {
    if ((event.dataTransfer?.types ?? []).includes('Files')) event.preventDefault();
  };
  node.addEventListener('paste', onPaste);
  node.addEventListener('drop', onDrop);
  node.addEventListener('dragover', onDragOver);
  return () => {
    node.removeEventListener('paste', onPaste);
    node.removeEventListener('drop', onDrop);
    node.removeEventListener('dragover', onDragOver);
  };
}
