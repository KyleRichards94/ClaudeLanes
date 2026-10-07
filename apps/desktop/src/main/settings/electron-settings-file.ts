import ElectronStore from 'electron-store';
import type { SettingsFile } from './settings-file';

/** `<userData>/settings.json`. */
export const SETTINGS_FILE_NAME = 'settings';

/**
 * The settings document in the app data folder, written through electron-store (atomic writes,
 * with the Windows rename fallbacks it carries). The whole document is read once at start-up and
 * replaced on each save; the version, migrations and validation stay in the settings service, so
 * electron-store's own schema, defaults and semver-keyed migrations are not used.
 *
 * Not watched: the app is the only writer, and a hand edit is never picked up while it runs (R5).
 */
export function createElectronSettingsFile(directory: string): SettingsFile {
  const store = new ElectronStore<Record<string, unknown>>({
    cwd: directory,
    name: SETTINGS_FILE_NAME,
    // Unreadable JSON reads as empty, so the service falls back to defaults instead of failing start-up.
    clearInvalidConfig: true,
    watch: false,
    accessPropertiesByDotNotation: false,
  });

  return {
    location: store.path,
    read() {
      const data = store.store;
      return Object.keys(data).length === 0 ? undefined : { ...data };
    },
    write(settings) {
      store.store = structuredClone(settings);
    },
  };
}
