import {
  SettingsPatchSchema,
  SettingsSchema,
  defaultSettings,
  err,
  ok,
  type Result,
  type Settings,
  type SettingsPatch,
} from '@agent-lanes/contracts';
import { loadSettings } from './load';
import type { SettingsFile } from './settings-file';

/**
 * Owns the app settings (AL-041): loads and migrates the file once at start-up, keeps the current
 * settings in memory, and writes the whole document on every accepted change. The renderer reaches it
 * through `settings:get` / `settings:update`; other main services call it directly.
 */
export interface SettingsService {
  /** The current settings, as a copy; change them with `update`. */
  get(): Settings;
  /**
   * Validates and applies a patch, saves, and returns the new settings. When the patch is invalid
   * or the save fails nothing changes, in memory or on disk.
   */
  update(patch: SettingsPatch): Result<Settings>;
}

export interface SettingsServiceOptions {
  file: SettingsFile;
  /** Where load problems are reported; the console until the app log exists (AL-214). */
  warn?: (message: string) => void;
}

export function createSettingsService({ file, warn = console.warn }: SettingsServiceOptions): SettingsService {
  let current = load(file, warn);

  return {
    get: () => structuredClone(current),

    update(patch) {
      const request = SettingsPatchSchema.safeParse(patch);
      if (!request.success) return err('VALIDATION', 'Invalid settings update', request.error.issues);

      const next = SettingsSchema.safeParse(applyPatch(current, request.data));
      if (!next.success) return err('VALIDATION', 'The update leaves the settings invalid', next.error.issues);

      try {
        file.write(next.data);
      } catch (cause) {
        return err('INTERNAL', `Could not save settings to ${file.location}: ${describe(cause)}`);
      }
      current = next.data;
      return ok(structuredClone(current));
    },
  };
}

function load(file: SettingsFile, warn: (message: string) => void): Settings {
  try {
    const { settings, migratedFrom, dropped } = loadSettings(file.read());
    if (dropped.length > 0) {
      warn(`Settings in ${file.location} had invalid values, now set to their defaults: ${dropped.join(', ')}`);
    }
    if (migratedFrom !== undefined) {
      // Save the migrated document now, so the file is never left at a version the app has moved past.
      try {
        file.write(settings);
      } catch (cause) {
        warn(`Settings migrated from version ${migratedFrom} but could not be saved: ${describe(cause)}`);
      }
    }
    return settings;
  } catch (cause) {
    warn(`Could not load settings from ${file.location}, using defaults: ${describe(cause)}`);
    return defaultSettings();
  }
}

/** Sections replace whole; inside `defaults` and `ui`, each field given replaces that field. */
function applyPatch(settings: Settings, patch: SettingsPatch): Settings {
  return {
    ...settings,
    ...definedEntries({ repos: patch.repos, buildQueueSize: patch.buildQueueSize, adoStateTransitions: patch.adoStateTransitions }),
    ...definedEntries({ agentPermissions: patch.agentPermissions, dropDefaults: patch.dropDefaults }),
    defaults: { ...settings.defaults, ...definedEntries(patch.defaults) },
    ui: { ...settings.ui, ...definedEntries(patch.ui) },
  };
}

/** Drops keys whose value is undefined, so `{ lastRepo: undefined }` leaves the stored value alone. */
function definedEntries<T extends object>(values: T | undefined): Partial<T> {
  if (!values) return {};
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
