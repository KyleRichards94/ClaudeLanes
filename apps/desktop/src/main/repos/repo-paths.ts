import { posix, win32 } from 'node:path';

/**
 * Repos are identified by the absolute path of their main checkout (D63). Windows and macOS file
 * systems ignore case by default, so `C:\Src\OSC` and `c:\src\osc\` are the same repo there.
 */
export function repoPathKey(path: string, platform: NodeJS.Platform = process.platform): string {
  const paths = platform === 'win32' ? win32 : posix;
  let normalized = paths.normalize(path);
  // A trailing separator does not make a different folder; the root keeps its own (`C:\`, `/`).
  while (normalized.length > paths.parse(normalized).root.length && /[\\/]$/.test(normalized)) {
    normalized = normalized.slice(0, -1);
  }
  return platform === 'win32' || platform === 'darwin' ? normalized.toLowerCase() : normalized;
}

export function isSameRepoPath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  return repoPathKey(a, platform) === repoPathKey(b, platform);
}
