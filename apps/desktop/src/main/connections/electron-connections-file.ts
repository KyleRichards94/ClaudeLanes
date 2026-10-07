import { renameSync } from 'node:fs';
import { join } from 'node:path';
import ElectronStore from 'electron-store';
import type { ConnectionsFile, ConnectionsFileRead } from './connections-file';

/** `<userData>/connections.json`. */
export const CONNECTIONS_FILE_NAME = 'connections';

/**
 * Connection records in the app data folder, written through electron-store (atomic writes with its
 * Windows rename fallbacks), as the settings file is (Decision D56). Unlike settings, invalid JSON is
 * not silently cleared: the file is moved aside as `connections.corrupt-<time>.json` and reported, so
 * the service knows the records were lost and does not tidy away the tokens they pointed to.
 */
export function createElectronConnectionsFile(directory: string, now: () => Date = () => new Date()): ConnectionsFile {
  const location = join(directory, `${CONNECTIONS_FILE_NAME}.json`);
  let store: ElectronStore<Record<string, unknown>> | undefined;

  /** `replaceInvalid`: open even over a corrupt file that could not be moved aside, so a save can replace it. */
  function open(replaceInvalid = false): ElectronStore<Record<string, unknown>> {
    store ??= new ElectronStore<Record<string, unknown>>({
      cwd: directory,
      name: CONNECTIONS_FILE_NAME,
      clearInvalidConfig: replaceInvalid,
      watch: false,
      accessPropertiesByDotNotation: false,
    });
    return store;
  }

  return {
    location,
    read(): ConnectionsFileRead {
      try {
        const data = open().store;
        return Object.keys(data).length === 0 ? { kind: 'missing' } : { kind: 'found', document: { ...data } };
      } catch (cause) {
        store = undefined;
        if (!(cause instanceof SyntaxError)) return { kind: 'unreadable', reason: 'io-error', backupPath: null };
        const backupPath = join(directory, `${CONNECTIONS_FILE_NAME}.corrupt-${now().toISOString().replace(/[:.]/g, '-')}.json`);
        try {
          renameSync(location, backupPath);
          return { kind: 'unreadable', reason: 'corrupt', backupPath };
        } catch {
          return { kind: 'unreadable', reason: 'corrupt', backupPath: null };
        }
      }
    },
    write(document) {
      let target: ElectronStore<Record<string, unknown>>;
      try {
        target = open();
      } catch (cause) {
        if (!(cause instanceof SyntaxError)) throw cause;
        target = open(true);
      }
      target.store = structuredClone(document) as unknown as Record<string, unknown>;
    },
  };
}
