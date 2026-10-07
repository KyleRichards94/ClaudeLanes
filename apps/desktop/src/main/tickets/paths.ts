import { createHash } from 'node:crypto';
import { posix, win32, type PlatformPath } from 'node:path';

/** `<userData>/tickets`: one folder per repo, one JSON file per ticket (design §6, D8). */
export const TICKETS_DIR_NAME = 'tickets';
export const RECORD_EXTENSION = '.json';

const KEY_NAME_MAX = 40;
const KEY_HASH_LENGTH = 12;

/** `<userData>/tickets`. */
export function ticketsRootDir(appDataDir: string, platform: NodeJS.Platform = process.platform): string {
  return pathFor(platform).join(appDataDir, TICKETS_DIR_NAME);
}

export function pathFor(platform: NodeJS.Platform): PlatformPath {
  return platform === 'win32' ? win32 : posix;
}

/**
 * How a path compares on this platform: resolved (no `..`, no trailing separator) and lowercased on
 * Windows, where `C:\Src\App` and `c:\src\app\` are the same folder.
 */
export function normalizePath(target: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = pathFor(platform).resolve(target);
  return platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Folder name for a repo's records: its folder name made file-safe, then a short hash of its
 * normalized path, e.g. `onsite-companion-3f2a9c1b04d7`. Readable in Explorer, and two repos with the
 * same folder name in different places never share a folder.
 */
export function repoKey(repoPath: string, platform: NodeJS.Platform = process.platform): string {
  const normalized = normalizePath(repoPath, platform);
  const name =
    pathFor(platform)
      .basename(normalized)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, KEY_NAME_MAX)
      .replace(/-+$/, '') || 'repo';
  const hash = createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, KEY_HASH_LENGTH);
  return `${name}-${hash}`;
}

/** `<root>/<repoKey>/<ticketId>.json`. The ticket id is already validated (letters, digits and dashes only). */
export function recordFilePath(rootDir: string, repoPath: string, ticketId: string, platform: NodeJS.Platform = process.platform): string {
  return pathFor(platform).join(rootDir, repoKey(repoPath, platform), `${ticketId}${RECORD_EXTENSION}`);
}

/**
 * True when `child` is `parent` or anything below it. Compares resolved paths, case-insensitively on
 * Windows; a sibling such as `C:\wt-2` is not inside `C:\wt`.
 */
export function isInsidePath(child: string, parent: string, platform: NodeJS.Platform = process.platform): boolean {
  const path = pathFor(platform);
  const relative = path.relative(normalizePath(parent, platform), normalizePath(child, platform));
  if (relative === '') return true;
  if (path.isAbsolute(relative)) return false;
  return relative !== '..' && !relative.startsWith(`..${path.sep}`);
}
