import type { Settings } from '@agent-lanes/contracts';

/**
 * Where the settings document lives. The app is its only writer (R5): nothing reads a file the
 * user is expected to edit, and nothing watches the file for outside changes.
 */
export interface SettingsFile {
  /** Full path, for messages and diagnostics. */
  readonly location: string;
  /** The stored document, or undefined when nothing has been saved yet. */
  read(): unknown;
  /** Replaces the stored document. */
  write(settings: Settings): void;
}

export interface MemorySettingsFile extends SettingsFile {
  /** What a real file would hold now (a JSON round trip of the last write). */
  readonly contents: unknown;
  /** Number of writes so far. */
  readonly writes: number;
}

/** In-memory stand-in for tests of the settings service and of services that read settings. */
export function createMemorySettingsFile(initial?: unknown): MemorySettingsFile {
  let contents: unknown = initial === undefined ? undefined : roundTrip(initial);
  let writes = 0;
  return {
    location: 'memory://settings.json',
    get contents() {
      return contents;
    },
    get writes() {
      return writes;
    },
    read: () => (contents === undefined ? undefined : roundTrip(contents)),
    write(settings) {
      contents = roundTrip(settings);
      writes += 1;
    },
  };
}

function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}
