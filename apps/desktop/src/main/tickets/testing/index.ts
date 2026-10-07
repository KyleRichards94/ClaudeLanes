import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { defaultStageGates } from '@agent-lanes/contracts';
import { nodeRecordFs, type RecordFs } from '../atomic-file';
import type { NewTicketRecord } from '../record';

/** Test helpers for the ticket record store, for this folder and for the tickets built on it (AL-090, AL-110). */

/** A temporary folder and a function that deletes it. */
export async function createTempDir(prefix = 'agent-lanes-tickets-'): Promise<{ dir: string; remove: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  return { dir, remove: () => rm(dir, { recursive: true, force: true, maxRetries: 5 }) };
}

/** Launch input for ticket 71273 in `<base>/onsite-companion`, worktree in `<base>/.agent-lanes/71273`. */
export function newTicketInput(base: string, overrides: Partial<NewTicketRecord> = {}): NewTicketRecord {
  const id = overrides.id ?? '71273';
  return {
    id,
    title: 'Cutover frmJobControl to Blazor',
    ado: { orgUrl: 'https://dev.azure.com/contoso', project: 'OnSite Companion', workItemId: 71273 },
    repo: join(base, 'onsite-companion'),
    baseBranch: 'main',
    branch: `${id}-cutover-frmjobcontrol-to`,
    worktreePath: join(base, '.agent-lanes', id),
    model: 'opus',
    effort: 'xhigh',
    gates: defaultStageGates(),
    skills: ['code-review'],
    ...overrides,
  };
}

/** Every file under `dir`, relative, sorted; folders end with `/`. */
export async function listTree(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .map((entry) => {
      const relative = join(entry.parentPath, entry.name).slice(dir.length + 1).replaceAll('\\', '/');
      return entry.isDirectory() ? `${relative}/` : relative;
    })
    .sort();
}

export interface MemoryRecordFs extends RecordFs {
  /** Path → contents. */
  readonly files: Map<string, string>;
  /** Completed renames onto a record file, i.e. records written. */
  readonly recordWrites: string[];
}

/**
 * Files in memory. Every operation settles in a microtask, so tests with fake timers see a write
 * finish as soon as its timer fires.
 */
export function createMemoryRecordFs(): MemoryRecordFs {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  const recordWrites: string[] = [];
  const missing = (path: string) => Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });

  function addFolder(path: string): void {
    for (let folder = path; !folders.has(folder); folder = dirname(folder)) {
      folders.add(folder);
      if (dirname(folder) === folder) break;
    }
  }

  return {
    files,
    recordWrites,
    async mkdir(path) {
      addFolder(path);
    },
    async readdir(path) {
      if (!folders.has(path)) throw missing(path);
      const fileEntries = [...files.keys()].filter((file) => dirname(file) === path).map((file) => ({ name: basename(file), isFile: true, isDirectory: false }));
      const folderEntries = [...folders].filter((folder) => folder !== path && dirname(folder) === path).map((folder) => ({ name: basename(folder), isFile: false, isDirectory: true }));
      return [...folderEntries, ...fileEntries];
    },
    async readFile(path) {
      const contents = files.get(path);
      if (contents === undefined) throw missing(path);
      return contents;
    },
    async writeFileSynced(path, data) {
      if (!folders.has(dirname(path))) throw missing(dirname(path));
      files.set(path, data);
    },
    async rename(from, to) {
      const contents = files.get(from);
      if (contents === undefined) throw missing(from);
      files.delete(from);
      files.set(to, contents);
      if (to.endsWith('.json')) recordWrites.push(to);
    },
    async rm(path) {
      files.delete(path);
    },
    async syncDir() {},
  };
}

/** Where a write is cut off, as if the process were killed at that moment. */
export type CrashPoint = 'while-writing-temp-file' | 'before-rename' | 'after-rename';

/**
 * The real file system until the next record write reaches `point`, where it stops for good: half
 * the bytes in the temporary file, a complete temporary file not yet renamed, or the rename done but
 * the folder not yet synced. `crashed` resolves when that happens. Use a fresh store afterwards, as
 * the app would after a restart.
 */
export function createCrashingFs(point: CrashPoint, base: RecordFs = nodeRecordFs): RecordFs & { crashed: Promise<void> } {
  let signal!: () => void;
  const crashed = new Promise<void>((resolve) => (signal = resolve));
  const never = new Promise<never>(() => undefined);
  let done = false;
  const crash = (): Promise<never> => {
    done = true;
    signal();
    return never;
  };
  return {
    ...base,
    crashed,
    async writeFileSynced(path, data) {
      if (done) return never;
      if (point === 'while-writing-temp-file') {
        await base.writeFileSynced(path, data.slice(0, Math.floor(data.length / 2)));
        return crash();
      }
      return base.writeFileSynced(path, data);
    },
    async rename(from, to) {
      if (done) return never;
      if (point === 'before-rename') return crash();
      return base.rename(from, to);
    },
    async syncDir(path) {
      if (done) return never;
      if (point === 'after-rename') return crash();
      return base.syncDir(path);
    },
  };
}
