import { join } from 'node:path';
import { SETTINGS_VERSION, SettingsSchema, defaultSettings, type Settings } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { loadSettings } from './load';
import { MIGRATIONS, type SettingsV1 } from './migrations';
import { createSettingsService } from './service';
import { createMemorySettingsFile } from './settings-file';

const repoPath = join('C:', 'src', 'onsite-companion');

const v1: SettingsV1 = {
  version: 1,
  lastRepo: repoPath,
  collapsedLanes: ['queued', 'done'],
  defaultModel: 'sonnet',
  defaultEffort: 'high',
  gatedStages: ['planning', 'qa'],
};

const expectedV2: Settings = {
  version: 2,
  repos: [
    {
      path: repoPath,
      name: 'onsite-companion',
      baseBranch: 'main',
      worktreeRoot: join('C:', 'src', '.agent-lanes'),
      buildCommand: null,
      runCommand: null,
      maxConcurrentAgents: 3,
    },
  ],
  defaults: {
    model: 'sonnet',
    effort: 'high',
    stageGates: { planning: 'approval', implementing: 'auto', 'code-review': 'auto', qa: 'approval', 'create-pr': 'auto' },
    skills: [],
  },
  buildQueueSize: 2,
  adoStateTransitions: false,
  ui: { lastRepo: repoPath, lastSprint: null, lastTeam: null, collapsedLanes: ['queued', 'done'], embedModeByTicket: {} },
};

describe('settings migration v1 → v2', () => {
  it('nests the prefs, turns the gated-stage list into gates, and registers the last repo', () => {
    const loaded = loadSettings(v1);
    expect(loaded.migratedFrom).toBe(1);
    expect(loaded.dropped).toEqual([]);
    expect(loaded.settings).toEqual(expectedV2);
    expect(SettingsSchema.safeParse(loaded.settings).success).toBe(true);
  });

  it('fills what version 1 did not have, or held invalid, from the version 2 defaults', () => {
    const loaded = loadSettings({ version: 1, lastRepo: null, collapsedLanes: 'qa', defaultModel: 'gpt', defaultEffort: 'low' });
    const defaults = defaultSettings();
    expect(loaded.settings).toEqual({
      ...defaults,
      defaults: { ...defaults.defaults, effort: 'low' },
    });
  });

  it('saves the migrated document at start-up so the file moves to version 2', () => {
    const file = createMemorySettingsFile(v1);
    const service = createSettingsService({ file, warn: vi.fn() });

    expect(service.get()).toEqual(expectedV2);
    expect(file.writes).toBe(1);
    expect(file.contents).toEqual(expectedV2);
  });

  it('a migrated file loads the same on the next start, with no second migration', () => {
    const file = createMemorySettingsFile(v1);
    createSettingsService({ file, warn: vi.fn() });
    const restarted = createSettingsService({ file, warn: vi.fn() });

    expect(restarted.get()).toEqual(expectedV2);
    expect(file.writes).toBe(1);
  });

  it('has a migration into every version after the first', () => {
    for (let version = 2; version <= SETTINGS_VERSION; version += 1) {
      expect(MIGRATIONS[version], `migration to version ${version}`).toBeTypeOf('function');
    }
  });
});

describe('settings saved before the board team (lastTeam)', () => {
  const savedBefore = {
    ...expectedV2,
    ui: { lastRepo: repoPath, lastSprint: 'sprint-42', collapsedLanes: ['queued', 'done'], embedModeByTicket: {} },
  };

  it('load with lastTeam null, keep every other UI pref, and drop nothing', () => {
    const loaded = loadSettings(savedBefore);
    expect(loaded.migratedFrom).toBeUndefined();
    expect(loaded.dropped).toEqual([]);
    expect(loaded.settings.ui).toEqual({ ...savedBefore.ui, lastTeam: null });
  });

  it('keep a saved team, and refuse an empty one in favour of the default', () => {
    expect(loadSettings({ ...savedBefore, ui: { ...savedBefore.ui, lastTeam: 'team-1' } }).settings.ui.lastTeam).toBe('team-1');
    const empty = loadSettings({ ...savedBefore, ui: { ...savedBefore.ui, lastTeam: '' } });
    expect(empty.settings.ui).toEqual({ ...savedBefore.ui, lastTeam: null });
    expect(empty.dropped).toEqual(['ui.lastTeam']);
  });
});
