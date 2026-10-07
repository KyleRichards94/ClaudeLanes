import { defaultUiPrefs, type UiPrefs } from '@agent-lanes/contracts';
import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { invoke } from './ipc';

/**
 * Zustand `persist` storage backed by the main-process settings store (design §6: "Zustand persist
 * with electron-store"). Reads and writes only the `ui` section of the settings; the storage name
 * is not used. The main process owns versioning and migrations, so no persist version is stored.
 *
 * It never rejects: when the read fails the store keeps its defaults, and a failed write is logged.
 */
export function createUiPrefsStorage(): PersistStorage<UiPrefs, Promise<void>> {
  async function save(prefs: UiPrefs): Promise<void> {
    try {
      const result = await invoke('settings:update', { ui: prefs });
      if (!result.ok) console.warn(`UI prefs were not saved: ${result.message}`);
    } catch (cause) {
      console.warn('UI prefs were not saved', cause);
    }
  }

  return {
    async getItem(): Promise<StorageValue<UiPrefs> | null> {
      try {
        const result = await invoke('settings:get');
        if (result.ok) return { state: result.data.ui };
        console.warn(`UI prefs could not be loaded: ${result.message}`);
      } catch (cause) {
        console.warn('UI prefs could not be loaded', cause);
      }
      return null;
    },
    setItem: (_name, value) => save(value.state),
    removeItem: () => save(defaultUiPrefs()),
  };
}
