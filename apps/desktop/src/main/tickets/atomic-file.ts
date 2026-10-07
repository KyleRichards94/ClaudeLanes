import { mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/**
 * The file operations the ticket record store needs, as a seam: tests wrap the real ones to stop a
 * write part-way, the way a killed process would.
 */
export interface RecordFs {
  /** Creates the folder and any missing parents. */
  mkdir(path: string): Promise<void>;
  /** The folder's entries; rejects with ENOENT when it does not exist. */
  readdir(path: string): Promise<RecordDirEntry[]>;
  readFile(path: string): Promise<string>;
  /** Creates or truncates `path`, writes `data`, flushes it to the disk (fsync) and closes it. */
  writeFileSynced(path: string, data: string): Promise<void>;
  /** Replaces `to` with `from` in one step (same folder, same volume). */
  rename(from: string, to: string): Promise<void>;
  /** Removes a file; no error when it is already gone. */
  rm(path: string): Promise<void>;
  /** Flushes a folder's entries so a rename survives a power cut. Best effort: Windows cannot open a folder for this. */
  syncDir(path: string): Promise<void>;
}

export interface RecordDirEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
}

export const nodeRecordFs: RecordFs = {
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  },
  async readdir(path) {
    const entries = await readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({ name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory() }));
  },
  readFile: (path) => readFile(path, 'utf8'),
  async writeFileSynced(path, data) {
    const handle = await open(path, 'w');
    try {
      await handle.writeFile(data, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  rename: (from, to) => rename(from, to),
  rm: (path) => rm(path, { force: true }),
  async syncDir(path) {
    if (process.platform === 'win32') return;
    const handle = await open(path, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
};

/** Suffix of the temporary file a write goes through; a leftover one belongs to a process that died mid-write. */
export const TEMP_SUFFIX = '.tmp';

let tempCounter = 0;

/** `<file>.<pid>-<n>.tmp`, next to the target so the rename stays on one volume. */
export function tempPathFor(filePath: string): string {
  tempCounter += 1;
  return `${filePath}.${process.pid}-${tempCounter}${TEMP_SUFFIX}`;
}

/**
 * Replaces `filePath` with `data` so that a reader (or the app after a crash) sees either the old
 * file or the new one, never a mix: write and fsync a temporary file next to it, then rename it over
 * the target. A process killed before the rename leaves the old file and a stray temporary file,
 * which the record store deletes on its next start.
 */
export async function writeFileAtomic(fs: RecordFs, filePath: string, data: string): Promise<void> {
  const folder = dirname(filePath);
  await fs.mkdir(folder);
  const tempPath = tempPathFor(filePath);
  try {
    await fs.writeFileSynced(tempPath, data);
    await renameWithRetry(fs, tempPath, filePath);
  } catch (cause) {
    await fs.rm(tempPath).catch(() => undefined);
    throw cause;
  }
  await fs.syncDir(folder).catch(() => undefined);
}

/** Windows can refuse a replace for a moment while a scanner or indexer has the file open. */
async function renameWithRetry(fs: RecordFs, from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (cause) {
      const code = errnoCode(cause);
      const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES';
      if (!retryable || attempt >= 4) throw cause;
      await delay(25 * 2 ** attempt);
    }
  }
}

export function errnoCode(cause: unknown): string {
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'unknown error';
}
