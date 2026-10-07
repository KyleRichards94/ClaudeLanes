import type { z } from 'zod';
import {
  AgentDefaultsSchema,
  RepoSettingsSchema,
  SETTINGS_VERSION,
  SettingsSchema,
  UiPrefsSchema,
  defaultSettings,
  type RepoSettings,
  type Settings,
} from '@agent-lanes/contracts';
import { migrateSettings, readVersion } from './migrations';
import { createRepoSettings } from './repo-settings';

export interface LoadedSettings {
  settings: Settings;
  /** The file's version when it was older than SETTINGS_VERSION and has been migrated. */
  migratedFrom?: number;
  /** Paths of stored values that were invalid and have been replaced by defaults. */
  dropped: string[];
}

/**
 * Turns whatever the settings file holds into valid current settings: migrate an older version,
 * then keep every valid value and replace each invalid one with its default, so one bad value never
 * costs the user the rest (a missing value is a field added since, and quietly gets its default).
 * A document with no usable version, or a newer one, is read as the current version.
 */
export function loadSettings(stored: unknown): LoadedSettings {
  if (stored === undefined) return { settings: defaultSettings(), dropped: [] };
  if (!isRecord(stored)) return { settings: defaultSettings(), dropped: ['(document)'] };

  const dropped: string[] = [];
  const version = readVersion(stored);
  if (version === undefined || version > SETTINGS_VERSION) dropped.push('version');

  if (version !== undefined && version < SETTINGS_VERSION) {
    const migrated = migrateSettings(stored, version);
    return { settings: toCurrent(migrated, dropped), migratedFrom: version, dropped };
  }
  return { settings: toCurrent(stored, dropped), dropped };
}

function toCurrent(document: unknown, dropped: string[]): Settings {
  const fallback = defaultSettings();
  const stored = isRecord(document) ? document : {};
  const settings: Settings = {
    version: SETTINGS_VERSION,
    repos: salvageRepos(stored['repos'], dropped),
    defaults: salvageObject(AgentDefaultsSchema, stored['defaults'], fallback.defaults, 'defaults', dropped),
    buildQueueSize: salvageValue(SettingsSchema.shape.buildQueueSize, stored['buildQueueSize'], fallback.buildQueueSize, 'buildQueueSize', dropped),
    ui: salvageObject(UiPrefsSchema, stored['ui'], fallback.ui, 'ui', dropped),
  };
  // Valid by construction; parse anyway so a mistake here fails loudly instead of saving bad settings.
  return SettingsSchema.parse(settings);
}

/** Keeps each repo that has a usable path, salvaging its other fields; the first of two equal paths wins. */
function salvageRepos(stored: unknown, dropped: string[]): RepoSettings[] {
  if (stored === undefined) return [];
  if (!Array.isArray(stored)) {
    dropped.push('repos');
    return [];
  }

  const repos: RepoSettings[] = [];
  stored.forEach((item: unknown, index) => {
    const path = isRecord(item) ? RepoSettingsSchema.shape.path.safeParse(item['path']) : undefined;
    if (!path?.success || repos.some((repo) => repo.path === path.data)) {
      dropped.push(`repos[${index}]`);
      return;
    }
    repos.push(salvageObject(RepoSettingsSchema, item, createRepoSettings(path.data), `repos[${index}]`, dropped));
  });
  return repos;
}

function salvageObject<S extends z.ZodObject>(schema: S, stored: unknown, fallback: z.output<S>, path: string, dropped: string[]): z.output<S> {
  if (stored === undefined) return fallback;
  const whole = schema.safeParse(stored);
  if (whole.success) return whole.data;
  if (!isRecord(stored)) {
    dropped.push(path);
    return fallback;
  }

  const salvaged: Record<string, unknown> = { ...fallback };
  for (const [key, field] of Object.entries(schema.shape as Record<string, z.ZodType>)) {
    salvaged[key] = salvageValue(field, stored[key], salvaged[key], `${path}.${key}`, dropped);
  }
  return salvaged as z.output<S>;
}

function salvageValue<T>(schema: z.ZodType<T>, stored: unknown, fallback: T, path: string, dropped: string[]): T {
  if (stored === undefined) return fallback;
  const parsed = schema.safeParse(stored);
  if (parsed.success) return parsed.data;
  dropped.push(path);
  return fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
