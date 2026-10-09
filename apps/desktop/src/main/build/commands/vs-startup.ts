import { open, readdir } from 'node:fs/promises';
import { join, posix } from 'node:path';

/** Larger `.suo` files are skipped rather than read. */
export const MAX_SUO_BYTES = 32 * 1024 * 1024;

/** `StartupProject=` as Visual Studio writes it into the `.suo`'s SolutionConfiguration stream (UTF-16LE). */
const STARTUP_KEY = Buffer.from('StartupProject=', 'utf16le');
/** How far past the key the project's `{GUID}` may start (a type marker and `&` come first). */
const VALUE_WINDOW_BYTES = 128;
const GUID = /\{([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})\}/;

/**
 * The project id (upper-case GUID, no braces) saved as `StartupProject=` in a `.suo`'s bytes, or
 * null. The `.suo` is a compound file, but the SolutionConfiguration stream is small enough to sit
 * in one run of bytes, so a byte search finds it without parsing the container.
 */
export function startupProjectIdFromSuo(bytes: Buffer): string | null {
  const at = bytes.indexOf(STARTUP_KEY);
  if (at < 0) return null;
  const start = at + STARTUP_KEY.length;
  // Read from both byte alignments so a stray odd byte before the GUID cannot hide it.
  const window = bytes.subarray(start, start + VALUE_WINDOW_BYTES);
  for (const text of [window.toString('utf16le'), window.subarray(1).toString('utf16le')]) {
    const match = GUID.exec(text);
    if (match?.[1]) return match[1].toUpperCase();
  }
  return null;
}

/** `v18` → 18; anything else is not a Visual Studio version folder. */
function vsVersion(name: string): number | null {
  const match = /^v(\d+)$/i.exec(name);
  return match ? Number(match[1]) : null;
}

async function readSmallFile(path: string): Promise<Buffer | null> {
  try {
    const handle = await open(path, 'r');
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || stats.size > MAX_SUO_BYTES) return null;
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}

/**
 * The start-up project Visual Studio saved for a solution: `<solution folder>/.vs/<solution name>/v<N>/.suo`
 * in `checkout`, newest Visual Studio first. `.vs` is per-user and usually git-ignored, so `checkout`
 * is the repo's main checkout even when commands are detected in a ticket's worktree. Null when
 * Visual Studio never opened the solution there.
 */
export async function readVsStartupProjectId(checkout: string, solutionPath: string): Promise<string | null> {
  const name = posix.basename(solutionPath).replace(/\.[^.]+$/, '');
  const stateDir = join(checkout, ...posix.dirname(solutionPath).split('/').filter((part) => part !== '.'), '.vs', name);
  let versions: string[];
  try {
    versions = (await readdir(stateDir, { withFileTypes: true })).filter((entry) => entry.isDirectory() && vsVersion(entry.name) !== null).map((entry) => entry.name);
  } catch {
    return null;
  }
  versions.sort((a, b) => (vsVersion(b) ?? 0) - (vsVersion(a) ?? 0));
  for (const version of versions) {
    const bytes = await readSmallFile(join(stateDir, version, '.suo'));
    const id = bytes ? startupProjectIdFromSuo(bytes) : null;
    if (id) return id;
  }
  return null;
}
