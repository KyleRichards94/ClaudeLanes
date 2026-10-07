import {
  TICKET_RECORD_VERSION,
  TicketIdSchema,
  TicketRecordSchema,
  err,
  ok,
  type Result,
  type TicketRecord,
} from '@agent-lanes/contracts';
import { TEMP_SUFFIX, errnoCode, nodeRecordFs, writeFileAtomic, type RecordFs } from './atomic-file';
import { RECORD_EXTENSION, isInsidePath, normalizePath, pathFor, recordFilePath } from './paths';
import { createTicketRecord, stampChange, type NewTicketRecord } from './record';

/**
 * Ticket records (AL-101, design §6, R2, Decision D8): one app-written JSON file per ticket in
 * `<userData>/tickets/<repoKey>/<ticketId>.json`, holding what the app needs to rebuild the board and
 * resume sessions after a restart (AL-090, AL-110).
 *
 * - **Atomic:** every write goes to a temporary file that is fsynced and then renamed over the record,
 *   so killing the app mid-write leaves the previous record, never a torn one. Stray temporary files
 *   are deleted on the next start.
 * - **Validated:** records are checked with `TicketRecordSchema` on read and before every write. A
 *   corrupt or invalid file is moved aside (`<id>.corrupt-<time>.json`) and reported by `issues()`; a
 *   record from a newer app version is left alone and never overwritten.
 * - **Debounced:** `update` changes the record in memory at once and writes it after `debounceMs`
 *   without further changes, or `maxWaitMs` after the first unsaved change, whichever comes first.
 *   `create` and `delete` reach the disk before they resolve; `flush` and `dispose` save the rest.
 * - **Never inside a worktree:** a record whose file would land inside its repo, its worktree or a
 *   sub-branch worktree is refused, so the store can never make a worktree dirty (GIT_DIRTY).
 *
 * Ticket ids are unique across repos, because events and the renderer key tickets by id alone.
 */
export interface TicketRecordStore {
  /** Every record, oldest first; with `repo`, only that repo's (paths compare as the platform does). */
  list(filter?: { repo?: string }): Promise<TicketRecord[]>;
  get(ticketId: string): Promise<TicketRecord | undefined>;
  /** Builds, validates and writes a new record before resolving. `VALIDATION` when the id is taken or a field is invalid. */
  create(input: NewTicketRecord): Promise<Result<TicketRecord>>;
  /**
   * Applies `change` to a copy of the record; the store stamps `updatedAt` and, when `stage` changed,
   * a `stageHistory` entry. Saved after the debounce. `id`, `repo`, `version` and `createdAt` never change.
   */
  update(ticketId: string, change: (current: TicketRecord) => TicketRecord): Promise<Result<TicketRecord>>;
  /** Removes the record and its file (a launch that failed, or Archive in AL-088). `false` when there was none. */
  delete(ticketId: string): Promise<Result<boolean>>;
  /** Writes unsaved changes now: one ticket's, or every ticket's. */
  flush(ticketId?: string): Promise<Result<void>>;
  /** Problems found while reading the records at start-up (AL-090 shows them). */
  issues(): Promise<TicketRecordIssue[]>;
  /** Saves every unsaved change (app quit); later changes are written straight away. */
  dispose(): Promise<void>;
}

export type TicketRecordIssue =
  /** Not JSON, or not a valid record: moved aside to `movedTo` (null when the move failed). */
  | { kind: 'unreadable'; file: string; ticketId: string; reason: 'corrupt' | 'invalid'; movedTo: string | null }
  /** Written by a newer Agent Lanes: left as it is and never overwritten. */
  | { kind: 'newer-version'; file: string; ticketId: string; version: number }
  /** The same ticket id in two repo folders: the newer record is used, this file is left alone. */
  | { kind: 'duplicate'; file: string; ticketId: string; keptFile: string }
  /** A folder or file could not be read (e.g. locked); records in it are missing until the next start. */
  | { kind: 'io-error'; file: string; code: string };

export interface TicketRecordStoreOptions {
  /** `<userData>/tickets`. */
  rootDir: string;
  fs?: RecordFs;
  now?: () => number;
  /** Quiet time after the last change before a record is written. */
  debounceMs?: number;
  /** Longest a changed record waits while changes keep coming. */
  maxWaitMs?: number;
  /** Wait before retrying a failed write. */
  retryMs?: number;
  /** How paths compare (case-insensitive on Windows). Defaults to `process.platform`. */
  platform?: NodeJS.Platform;
  /** One line per problem. Defaults to console.warn until the app log exists (AL-214). */
  warn?: (message: string) => void;
}

export const DEFAULT_DEBOUNCE_MS = 250;
export const DEFAULT_MAX_WAIT_MS = 1_000;
export const DEFAULT_RETRY_MS = 5_000;

interface Entry {
  record: TicketRecord;
  file: string;
  /** Bumped by every accepted change. */
  revision: number;
  /** The revision on disk. */
  savedRevision: number;
  debounce: NodeJS.Timeout | null;
  maxWait: NodeJS.Timeout | null;
  retry: NodeJS.Timeout | null;
  /** This ticket's writes, one at a time; never rejects. */
  writes: Promise<void>;
  /** Why the last write failed; null once a write succeeds. */
  failure: string | null;
  deleted: boolean;
}

export function createTicketRecordStore(options: TicketRecordStoreOptions): TicketRecordStore {
  const { rootDir } = options;
  const fs = options.fs ?? nodeRecordFs;
  const now = options.now ?? Date.now;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const platform = options.platform ?? process.platform;
  const path = pathFor(platform);
  const warn = options.warn ?? ((message: string) => console.warn(`[tickets] ${message}`));

  const entries = new Map<string, Entry>();
  const loadIssues: TicketRecordIssue[] = [];
  /** Ids being created, so two launches of one id cannot both write. */
  const creating = new Set<string>();
  let disposed = false;

  // Read every record at start-up, so the board (AL-090) and the first `create` see what is on disk.
  const loaded = load();

  async function load(): Promise<void> {
    const repoFolders = await listFolder(rootDir);
    let strayTempFiles = 0;
    for (const folder of repoFolders) {
      if (!folder.isDirectory) continue;
      const folderPath = path.join(rootDir, folder.name);
      for (const file of await listFolder(folderPath)) {
        if (!file.isFile) continue;
        const filePath = path.join(folderPath, file.name);
        if (file.name.endsWith(TEMP_SUFFIX)) {
          // Left by a process that died mid-write; the record next to it is the last complete one.
          await fs.rm(filePath).catch(() => undefined);
          strayTempFiles += 1;
        } else if (file.name.endsWith(RECORD_EXTENSION)) {
          const ticketId = file.name.slice(0, -RECORD_EXTENSION.length);
          if (TicketIdSchema.safeParse(ticketId).success) await readRecord(filePath, ticketId);
        }
      }
    }
    if (strayTempFiles > 0) warn(`Removed ${strayTempFiles} unfinished write(s) left by an earlier run.`);
  }

  async function listFolder(folder: string) {
    try {
      return await fs.readdir(folder);
    } catch (cause) {
      const code = errnoCode(cause);
      if (code !== 'ENOENT') {
        loadIssues.push({ kind: 'io-error', file: folder, code });
        warn(`Could not list ${folder} (${code}); the ticket records in it are missing until the next start.`);
      }
      return [];
    }
  }

  async function readRecord(file: string, ticketId: string): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(file);
    } catch (cause) {
      const code = errnoCode(cause);
      loadIssues.push({ kind: 'io-error', file, code });
      warn(`Could not read ${file} (${code}); ticket ${ticketId} is missing until the next start.`);
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      await setAside(file, ticketId, 'corrupt');
      return;
    }

    const version = (json as { version?: unknown } | null)?.version;
    if (typeof version === 'number' && version > TICKET_RECORD_VERSION) {
      loadIssues.push({ kind: 'newer-version', file, ticketId, version });
      warn(`${file} was written by a newer Agent Lanes (record version ${version}); it is left as it is.`);
      return;
    }

    const parsed = TicketRecordSchema.safeParse(json);
    if (!parsed.success || parsed.data.id !== ticketId) {
      await setAside(file, ticketId, 'invalid');
      return;
    }

    const existing = entries.get(ticketId);
    if (existing) {
      const keepNew = parsed.data.updatedAt > existing.record.updatedAt;
      const [kept, dropped] = keepNew ? [file, existing.file] : [existing.file, file];
      loadIssues.push({ kind: 'duplicate', file: dropped, ticketId, keptFile: kept });
      warn(`Ticket ${ticketId} has records in ${kept} and ${dropped}; using ${kept}.`);
      if (!keepNew) return;
    }
    entries.set(ticketId, newEntry(parsed.data, file, 0));
  }

  /** Keeps the unreadable file for diagnosis under a name the loader skips, so the ticket id is free again. */
  async function setAside(file: string, ticketId: string, reason: 'corrupt' | 'invalid'): Promise<void> {
    const stamp = new Date(now()).toISOString().replace(/[:.]/g, '-');
    const target = path.join(path.dirname(file), `${ticketId}.corrupt-${stamp}${RECORD_EXTENSION}`);
    let movedTo: string | null = null;
    try {
      await fs.rename(file, target);
      movedTo = target;
    } catch (cause) {
      warn(`Could not move ${file} aside (${errnoCode(cause)}).`);
    }
    loadIssues.push({ kind: 'unreadable', file, ticketId, reason, movedTo });
    warn(`${file} is ${reason === 'corrupt' ? 'not valid JSON' : 'not a valid ticket record'}; ticket ${ticketId} was not loaded.`);
  }

  function newEntry(record: TicketRecord, file: string, revision: number): Entry {
    return {
      record,
      file,
      revision,
      savedRevision: revision,
      debounce: null,
      maxWait: null,
      retry: null,
      writes: Promise.resolve(),
      failure: null,
      deleted: false,
    };
  }

  /** A reason the record cannot be stored, or null. Checked on create and on every update. */
  function pathProblem(record: TicketRecord, file: string): string | null {
    const folders = [record.repo, record.worktreePath, ...record.subBranches.map((sub) => sub.worktreePath)];
    const relative = folders.find((folder) => !path.isAbsolute(folder));
    if (relative !== undefined) return `Ticket ${record.id}: "${relative}" is not an absolute path.`;
    const inside = folders.find((folder) => isInsidePath(file, folder, platform));
    if (inside !== undefined) {
      return `Ticket ${record.id}: its record (${file}) would be written inside ${inside}; records stay out of repos and worktrees.`;
    }
    return null;
  }

  function serialize(record: TicketRecord): string {
    return `${JSON.stringify(record, null, 2)}\n`;
  }

  function clearTimers(entry: Entry): void {
    for (const timer of [entry.debounce, entry.maxWait, entry.retry]) if (timer) clearTimeout(timer);
    entry.debounce = null;
    entry.maxWait = null;
    entry.retry = null;
  }

  function timer(callback: () => void, ms: number): NodeJS.Timeout {
    const handle = setTimeout(callback, ms);
    handle.unref();
    return handle;
  }

  function scheduleWrite(entry: Entry): void {
    if (disposed) {
      void enqueueWrite(entry);
      return;
    }
    if (entry.debounce) clearTimeout(entry.debounce);
    entry.debounce = timer(() => void enqueueWrite(entry), debounceMs);
    entry.maxWait ??= timer(() => void enqueueWrite(entry), maxWaitMs);
  }

  /** Queues a write of whatever the record holds when the write starts. */
  function enqueueWrite(entry: Entry): Promise<void> {
    clearTimers(entry);
    entry.writes = entry.writes.then(() => writeNow(entry));
    return entry.writes;
  }

  async function writeNow(entry: Entry): Promise<void> {
    if (entry.deleted || entry.savedRevision >= entry.revision) return;
    // `create` and `update` already refused a record whose file would land inside a repo or worktree.
    const { record, revision } = entry;
    try {
      await writeFileAtomic(fs, entry.file, serialize(record));
      entry.savedRevision = Math.max(entry.savedRevision, revision);
      if (entry.failure) warn(`Ticket ${record.id} saved again after: ${entry.failure}`);
      entry.failure = null;
    } catch (cause) {
      const reason = `could not write ${entry.file} (${errnoCode(cause)})`;
      if (entry.failure === null) warn(`Ticket ${record.id} not saved: ${reason}. Retrying.`);
      entry.failure = reason;
      if (!disposed && !entry.deleted) entry.retry ??= timer(() => void enqueueWrite(entry), retryMs);
    }
  }

  function clone(record: TicketRecord): TicketRecord {
    return structuredClone(record);
  }

  const store: TicketRecordStore = {
    async list(filter) {
      await loaded;
      const repo = filter?.repo === undefined ? undefined : normalizePath(filter.repo, platform);
      return [...entries.values()]
        .map((entry) => entry.record)
        .filter((record) => repo === undefined || normalizePath(record.repo, platform) === repo)
        .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map(clone);
    },

    async get(ticketId) {
      await loaded;
      const entry = entries.get(ticketId);
      return entry ? clone(entry.record) : undefined;
    },

    async create(input) {
      await loaded;
      const parsed = TicketRecordSchema.safeParse(createTicketRecord(input, now()));
      if (!parsed.success) return err('VALIDATION', 'Invalid ticket record', parsed.error.issues);
      const record = parsed.data;
      if (entries.has(record.id) || creating.has(record.id)) {
        return err('VALIDATION', `A ticket with id ${record.id} already exists`, { ticketId: record.id });
      }
      const file = recordFilePath(rootDir, record.repo, record.id, platform);
      const problem = pathProblem(record, file);
      if (problem) return err('VALIDATION', problem, { ticketId: record.id });

      creating.add(record.id);
      try {
        // Never replace a file the loader did not take in (newer version, unreadable, or written since).
        const occupied = await fileExists(file);
        if (occupied !== false) {
          return err(
            occupied === true ? 'VALIDATION' : 'INTERNAL',
            occupied === true ? `A record file for ticket ${record.id} already exists` : `Could not check ${file} (${occupied})`,
            { ticketId: record.id },
          );
        }
        await writeFileAtomic(fs, file, serialize(record));
      } catch (cause) {
        return err('INTERNAL', `Could not write ${file} (${errnoCode(cause)})`, { ticketId: record.id });
      } finally {
        creating.delete(record.id);
      }
      entries.set(record.id, newEntry(record, file, 1));
      return ok(clone(record));
    },

    async update(ticketId, change) {
      await loaded;
      const entry = entries.get(ticketId);
      if (!entry) return err('VALIDATION', `No ticket record ${ticketId}`, { ticketId });
      const current = entry.record;

      let changed: TicketRecord;
      try {
        changed = change(clone(current));
      } catch (cause) {
        return err('INTERNAL', `Updating ticket ${ticketId} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      if (
        changed.id !== current.id ||
        changed.repo !== current.repo ||
        changed.version !== current.version ||
        changed.createdAt !== current.createdAt
      ) {
        return err('VALIDATION', `A ticket's id, repo, version and createdAt never change (${ticketId})`, { ticketId });
      }

      const parsed = TicketRecordSchema.safeParse(stampChange(changed, now()));
      if (!parsed.success) return err('VALIDATION', `Invalid change to ticket ${ticketId}`, parsed.error.issues);
      const problem = pathProblem(parsed.data, entry.file);
      if (problem) return err('VALIDATION', problem, { ticketId });

      entry.record = parsed.data;
      entry.revision += 1;
      scheduleWrite(entry);
      return ok(clone(parsed.data));
    },

    async delete(ticketId) {
      await loaded;
      const entry = entries.get(ticketId);
      if (!entry) return ok(false);
      clearTimers(entry);
      entry.deleted = true;
      entries.delete(ticketId);
      // Let a write already under way land first, so it cannot recreate the file afterwards.
      await entry.writes;
      try {
        await fs.rm(entry.file);
      } catch (cause) {
        entry.deleted = false;
        entries.set(ticketId, entry);
        return err('INTERNAL', `Could not remove ${entry.file} (${errnoCode(cause)})`, { ticketId });
      }
      return ok(true);
    },

    async flush(ticketId) {
      await loaded;
      const targets = ticketId === undefined ? [...entries.values()] : [entries.get(ticketId)].filter((entry) => entry !== undefined);
      await Promise.all(targets.map((entry) => enqueueWrite(entry)));
      const unsaved = targets.filter((entry) => !entry.deleted && entry.savedRevision < entry.revision);
      if (unsaved.length === 0) return ok(undefined);
      return err('INTERNAL', `Could not save ticket record(s): ${unsaved.map((entry) => entry.record.id).join(', ')}`, {
        failures: unsaved.map((entry) => ({ ticketId: entry.record.id, reason: entry.failure })),
      });
    },

    async issues() {
      await loaded;
      return structuredClone(loadIssues);
    },

    async dispose() {
      disposed = true;
      const result = await store.flush();
      if (!result.ok) warn(`Quitting with unsaved ticket records: ${result.message}`);
    },
  };

  /** true / false, or the error code when the check itself failed. */
  async function fileExists(file: string): Promise<boolean | string> {
    try {
      await fs.readFile(file);
      return true;
    } catch (cause) {
      const code = errnoCode(cause);
      return code === 'ENOENT' ? false : code;
    }
  }

  return store;
}

