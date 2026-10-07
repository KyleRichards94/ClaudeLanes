import type { ConnectionsDocument } from './records';

/** What reading `connections.json` found. */
export type ConnectionsFileRead =
  /** Nothing saved yet. */
  | { kind: 'missing' }
  | { kind: 'found'; document: unknown }
  /**
   * `corrupt`: not JSON; the file was moved to `backupPath` (null if that failed) and saved
   * connections are lost. `io-error`: it exists but can't be read right now; it is left alone.
   */
  | { kind: 'unreadable'; reason: 'corrupt' | 'io-error'; backupPath: string | null };

/**
 * Where connection records live. The app is the only writer (R5): nothing reads a file the user is
 * expected to edit, and nothing watches the file for outside changes.
 */
export interface ConnectionsFile {
  /** Full path, for messages and diagnostics. */
  readonly location: string;
  read(): ConnectionsFileRead;
  /** Replaces the stored document. Throws when it cannot. */
  write(document: ConnectionsDocument): void;
}

export interface MemoryConnectionsFile extends ConnectionsFile {
  /** What a real file would hold now (a JSON round trip of the last write); undefined before any. */
  readonly contents: unknown;
  /** Number of successful writes so far. */
  readonly writes: number;
  /** Set to make every write throw, like a full disk or a locked file. */
  failWrites: boolean;
  /** Set to make reads report the file as unreadable. */
  unreadable: 'corrupt' | 'io-error' | null;
}

/** In-memory stand-in for tests of the connections service and of services that read connections. */
export function createMemoryConnectionsFile(initial?: unknown): MemoryConnectionsFile {
  let contents: unknown = initial === undefined ? undefined : roundTrip(initial);
  let writes = 0;

  const file: MemoryConnectionsFile = {
    location: 'memory://connections.json',
    failWrites: false,
    unreadable: null,
    get contents() {
      return contents;
    },
    get writes() {
      return writes;
    },
    read() {
      if (file.unreadable === 'corrupt') {
        // Like the real file: set aside, so the next read starts empty.
        file.unreadable = null;
        contents = undefined;
        return { kind: 'unreadable', reason: 'corrupt', backupPath: 'memory://connections.corrupt.json' };
      }
      if (file.unreadable === 'io-error') return { kind: 'unreadable', reason: 'io-error', backupPath: null };
      return contents === undefined ? { kind: 'missing' } : { kind: 'found', document: roundTrip(contents) };
    },
    write(document) {
      if (file.failWrites) throw new Error('EPERM: simulated write failure');
      contents = roundTrip(document);
      writes += 1;
    },
  };
  return file;
}

function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
