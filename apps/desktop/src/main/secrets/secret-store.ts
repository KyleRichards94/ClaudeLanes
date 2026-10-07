import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname, join, parse } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';

/**
 * Main-only secret store (design §8, AL-040). Tokens are encrypted by the OS through Electron
 * `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret/kwallet on Linux) and kept in
 * `<userData>/secrets.json`. Only other main-process services hold this object: no IPC channel
 * returns a secret, and `list()` gives ids and timestamps only.
 *
 * There is no plaintext fallback. If the OS cannot encrypt, `put` refuses. If the file is corrupt,
 * or one entry no longer decrypts, those secrets are treated as missing (the owning connection asks
 * the user to reconnect) and nothing throws.
 */

export const SECRETS_FILE_NAME = 'secrets.json';
const FILE_VERSION = 1;

/** The part of Electron's `safeStorage` the store uses; tests pass a fake. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
  /** Linux only (the method is absent elsewhere). `basic_text` means a hard-coded key, i.e. no real encryption. */
  getSelectedStorageBackend?(): string;
}

/** What `list()` reveals about a secret: never the value, never the ciphertext. */
export interface SecretMetadata {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export type SecretStoreIssue =
  /** `secrets.json` could not be read; every secret in it is treated as missing. A corrupt file is moved aside to `backupPath`. */
  | { kind: 'file-unreadable'; reason: 'corrupt' | 'unsupported-version' | 'io-error'; backupPath: string | null }
  /** One entry was malformed and was dropped; treated as missing. */
  | { kind: 'entry-invalid'; id: string }
  /** The entry no longer decrypts here (e.g. the profile moved to another machine); treated as missing until replaced. */
  | { kind: 'entry-undecryptable'; id: string };

export interface SecretStoreStatus {
  /** False when the OS offers no real encryption; nothing can be saved until it does. */
  encryptionAvailable: boolean;
  /** Problems found while reading; each means "reconnect" for the connection that owns the id. */
  issues: SecretStoreIssue[];
}

export type SecretStoreErrorCode =
  | 'ENCRYPTION_UNAVAILABLE'
  | 'ENCRYPTION_FAILED'
  | 'INVALID_ID'
  | 'INVALID_SECRET'
  | 'STORE_UNREADABLE'
  | 'WRITE_FAILED';

/** Thrown by `put` and `delete` only. Messages never contain the secret. */
export class SecretStoreError extends Error {
  override readonly name = 'SecretStoreError';
  readonly code: SecretStoreErrorCode;

  constructor(code: SecretStoreErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export interface SecretStore {
  /** Encrypts and saves `secret` under `id`, replacing any previous value. Refuses without OS encryption. */
  put(id: string, secret: string): Promise<SecretMetadata>;
  /** The decrypted secret, or undefined when it is missing, corrupt or cannot be decrypted here. Never throws. */
  get(id: string): Promise<string | undefined>;
  /** Removes the secret; resolves false when there was none. */
  delete(id: string): Promise<boolean>;
  /** Ids and timestamps only, sorted by id. Never throws. */
  list(): Promise<SecretMetadata[]>;
  /** Whether encryption is usable and what went wrong while reading the file. Never throws. */
  status(): Promise<SecretStoreStatus>;
}

export interface SecretStoreOptions {
  /** Usually `<userData>/secrets.json`. */
  filePath: string;
  safeStorage: SafeStorageLike;
  now?: () => Date;
  /** Receives one line per problem; never a secret or ciphertext. Defaults to console.warn. */
  warn?: (message: string) => void;
  /**
   * Called with each plaintext secret the store saves or decrypts, before anyone else holds it, so
   * the app log can redact it wherever it later appears (AL-214). It must not keep it for anything else.
   */
  onPlaintext?: (secret: string) => void;
}

/** Ids name a connection's secret, e.g. `ado:contoso`, `claude:api-key`, `mcp:github`. */
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;
const MAX_SECRET_LENGTH = 64 * 1024;

const EntrySchema = z.object({
  ciphertext: z.base64().min(1),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
type Entry = z.infer<typeof EntrySchema>;

const FileSchema = z.object({
  version: z.number(),
  secrets: z.record(z.string(), z.unknown()),
});

interface LoadedState {
  entries: Map<string, Entry>;
  /** True when the file exists but could not be read (I/O error): writes would clobber it, so they are refused and loading is retried. */
  unreadable: boolean;
}

export function isValidSecretId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

export function createSecretStore(options: SecretStoreOptions): SecretStore {
  const { filePath, safeStorage } = options;
  const now = options.now ?? (() => new Date());
  const warn = options.warn ?? ((message: string) => console.warn(`[secrets] ${message}`));
  const onPlaintext = (secret: string) => {
    try {
      options.onPlaintext?.(secret);
    } catch {
      // A failing listener must not stop a token from being saved or used.
    }
  };

  const fileIssues: SecretStoreIssue[] = [];
  const entryIssues = new Map<string, SecretStoreIssue>();
  let loading: Promise<LoadedState> | null = null;
  let writes: Promise<unknown> = Promise.resolve();
  let tempCounter = 0;

  function encryptionAvailable(): boolean {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false;
      // On Linux without a keyring Chromium falls back to a hard-coded key: that is plaintext in disguise.
      return safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
    } catch {
      return false;
    }
  }

  function load(): Promise<LoadedState> {
    loading ??= readState().then((state) => {
      // An I/O error may be transient (a scanner holding the file), so try again next time.
      if (state.unreadable) loading = null;
      return state;
    });
    return loading;
  }

  async function readState(): Promise<LoadedState> {
    let raw: string;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (cause) {
      if (isErrnoCode(cause, 'ENOENT')) {
        setFileIssue(null);
        return { entries: new Map(), unreadable: false };
      }
      setFileIssue({ kind: 'file-unreadable', reason: 'io-error', backupPath: null });
      warn(`Could not read ${filePath} (${errnoCode(cause)}); saved secrets are treated as missing.`);
      return { entries: new Map(), unreadable: true };
    }

    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return setAsideCorruptFile('corrupt');
    }
    const file = FileSchema.safeParse(json);
    if (!file.success) return setAsideCorruptFile('corrupt');
    if (file.data.version !== FILE_VERSION) return setAsideCorruptFile('unsupported-version');

    const entries = new Map<string, Entry>();
    // Own keys of the parsed JSON only; ids are validated, so `__proto__` and friends are dropped.
    for (const [id, value] of Object.entries(file.data.secrets)) {
      const entry = EntrySchema.safeParse(value);
      if (isValidSecretId(id) && entry.success) {
        entries.set(id, entry.data);
      } else {
        const shownId = isValidSecretId(id) ? id : '(invalid id)';
        entryIssues.set(shownId, { kind: 'entry-invalid', id: shownId });
        warn(`Dropped a malformed entry ${shownId} from ${filePath}; it is treated as missing.`);
      }
    }
    setFileIssue(null);
    return { entries, unreadable: false };
  }

  /** Keeps the unreadable file for diagnosis, then starts empty so the user can reconnect. */
  async function setAsideCorruptFile(reason: 'corrupt' | 'unsupported-version'): Promise<LoadedState> {
    const { dir, name } = parse(filePath);
    const backupPath = join(dir, `${name}.corrupt-${now().toISOString().replace(/[:.]/g, '-')}.json`);
    let movedTo: string | null = null;
    try {
      await rename(filePath, backupPath);
      movedTo = backupPath;
    } catch (cause) {
      warn(`Could not move the unreadable ${filePath} aside (${errnoCode(cause)}); it will be replaced on the next save.`);
    }
    setFileIssue({ kind: 'file-unreadable', reason, backupPath: movedTo });
    warn(
      `${filePath} is ${reason === 'corrupt' ? 'corrupt' : 'from a newer version'}; saved secrets are treated as missing` +
        (movedTo ? ` (kept as ${movedTo}).` : '.'),
    );
    return { entries: new Map(), unreadable: false };
  }

  function setFileIssue(issue: SecretStoreIssue | null): void {
    fileIssues.length = 0;
    if (issue) fileIssues.push(issue);
  }

  /** Runs one change at a time against the loaded state, writes the file, then commits the change in memory. */
  function mutate<T>(change: (entries: Map<string, Entry>) => { next: Map<string, Entry> | null; result: T }): Promise<T> {
    const run = async (): Promise<T> => {
      const state = await load();
      if (state.unreadable) {
        throw new SecretStoreError('STORE_UNREADABLE', `${filePath} cannot be read right now; not overwriting it.`);
      }
      const { next, result } = change(state.entries);
      if (next) {
        await writeEntries(next);
        state.entries = next;
      }
      return result;
    };
    const queued = writes.then(run, run);
    writes = queued.catch(() => undefined);
    return queued;
  }

  async function writeEntries(entries: Map<string, Entry>): Promise<void> {
    const body = {
      version: FILE_VERSION,
      secrets: Object.fromEntries([...entries].sort(([a], [b]) => compareIds(a, b))),
    };
    const tempPath = `${filePath}.${process.pid}.${++tempCounter}.tmp`;
    try {
      await mkdir(dirname(filePath), { recursive: true });
      const handle = await open(tempPath, 'w', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(body, null, 2)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await renameWithRetry(tempPath, filePath);
    } catch (cause) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw new SecretStoreError('WRITE_FAILED', `Could not write ${filePath} (${errnoCode(cause)}).`);
    }
  }

  const store: SecretStore = {
    async put(id, secret) {
      if (!isValidSecretId(id)) {
        throw new SecretStoreError('INVALID_ID', 'Secret ids are 1–200 characters: letters, digits and . _ : @ / -');
      }
      if (typeof secret !== 'string' || secret.length === 0 || secret.length > MAX_SECRET_LENGTH) {
        throw new SecretStoreError('INVALID_SECRET', `The secret for ${id} is empty or too long.`);
      }
      onPlaintext(secret);
      if (!encryptionAvailable()) {
        throw new SecretStoreError(
          'ENCRYPTION_UNAVAILABLE',
          'This computer offers no secure storage for tokens (safeStorage unavailable), so nothing was saved.',
        );
      }
      let ciphertext: string;
      try {
        ciphertext = safeStorage.encryptString(secret).toString('base64');
      } catch {
        throw new SecretStoreError('ENCRYPTION_FAILED', `The secret for ${id} could not be encrypted, so it was not saved.`);
      }

      return mutate((entries) => {
        const at = now().toISOString();
        const entry: Entry = { ciphertext, createdAt: entries.get(id)?.createdAt ?? at, updatedAt: at };
        const next = new Map(entries).set(id, entry);
        return { next, result: toMetadata(id, entry) };
      }).then((metadata) => {
        entryIssues.delete(id);
        return metadata;
      });
    },

    async get(id) {
      if (!isValidSecretId(id)) return undefined;
      const entry = (await load()).entries.get(id);
      if (!entry || !encryptionAvailable()) return undefined;
      let secret: string;
      try {
        secret = safeStorage.decryptString(Buffer.from(entry.ciphertext, 'base64'));
      } catch {
        if (!entryIssues.has(id)) warn(`Secret ${id} could not be decrypted on this machine; it is treated as missing.`);
        entryIssues.set(id, { kind: 'entry-undecryptable', id });
        return undefined;
      }
      onPlaintext(secret);
      return secret;
    },

    async delete(id) {
      if (!isValidSecretId(id)) return false;
      const existed = await mutate((entries) => {
        if (!entries.has(id)) return { next: null, result: false };
        const next = new Map(entries);
        next.delete(id);
        return { next, result: true };
      });
      entryIssues.delete(id);
      return existed;
    },

    async list() {
      const { entries } = await load();
      return [...entries].map(([id, entry]) => toMetadata(id, entry)).sort((a, b) => compareIds(a.id, b.id));
    },

    async status() {
      await load();
      return {
        encryptionAvailable: encryptionAvailable(),
        issues: [...fileIssues, ...entryIssues.values()].map((issue) => ({ ...issue })),
      };
    },
  };

  // Read the file straight away so a corrupt one is set aside (and reported) before anything needs a token.
  void load();
  return store;
}

function toMetadata(id: string, entry: Entry): SecretMetadata {
  return { id, createdAt: entry.createdAt, updatedAt: entry.updatedAt };
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Windows can refuse a replace for a moment while a scanner or indexer has the file open. */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (cause) {
      const retryable = isErrnoCode(cause, 'EPERM') || isErrnoCode(cause, 'EBUSY') || isErrnoCode(cause, 'EACCES');
      if (!retryable || attempt >= 4) throw cause;
      await delay(25 * 2 ** attempt);
    }
  }
}

function errnoCode(cause: unknown): string {
  const code = (cause as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'unknown error';
}

function isErrnoCode(cause: unknown, code: string): boolean {
  return errnoCode(cause) === code;
}
