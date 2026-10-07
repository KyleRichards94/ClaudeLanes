import { describe, expect, it } from 'vitest';
import {
  SETTINGS_VERSION,
  SettingsPatchSchema,
  SettingsSchema,
  defaultSettings,
  defaultStageGates,
  settingsInvokeContracts,
  type RepoSettings,
} from './settings.schemas';

const repo: RepoSettings = {
  path: 'C:/src/onsite-companion',
  name: 'onsite-companion',
  baseBranch: 'main',
  worktreeRoot: 'C:/src/.agent-lanes',
  buildCommand: null,
  runCommand: null,
  maxConcurrentAgents: 3,
};

describe('settings contract', () => {
  it('defaults are valid settings at the current version', () => {
    const settings = SettingsSchema.parse(defaultSettings());
    expect(settings.version).toBe(SETTINGS_VERSION);
    expect(settings.ui.collapsedLanes).toEqual(['done']);
    expect(settings.buildQueueSize).toBe(2);
  });

  it('leaves ADO state transitions off by default (AL-063)', () => {
    expect(defaultSettings().adoStateTransitions).toBe(false);
    expect(SettingsPatchSchema.parse({ adoStateTransitions: true })).toEqual({ adoStateTransitions: true });
    expect(SettingsPatchSchema.safeParse({ adoStateTransitions: 'yes' }).success).toBe(false);
    expect(SettingsSchema.safeParse({ ...defaultSettings(), adoStateTransitions: undefined }).success).toBe(false);
  });

  it('gates Planning and Create PR by default, as design §9 says', () => {
    expect(defaultStageGates()).toEqual({
      planning: 'approval',
      implementing: 'auto',
      'code-review': 'auto',
      qa: 'auto',
      'create-pr': 'approval',
    });
  });

  it('hands out fresh defaults so callers cannot share and mutate them', () => {
    const first = defaultSettings();
    first.ui.collapsedLanes.push('qa');
    expect(defaultSettings().ui.collapsedLanes).toEqual(['done']);
  });

  it('refuses the same repo path twice', () => {
    const result = SettingsSchema.safeParse({ ...defaultSettings(), repos: [repo, { ...repo, name: 'again' }] });
    expect(result.success).toBe(false);
  });

  it('refuses a lane listed twice', () => {
    const settings = defaultSettings();
    const result = SettingsSchema.safeParse({ ...settings, ui: { ...settings.ui, collapsedLanes: ['qa', 'qa'] } });
    expect(result.success).toBe(false);
  });

  it('needs every stage in the gate map', () => {
    const settings = defaultSettings();
    const result = SettingsSchema.safeParse({
      ...settings,
      defaults: { ...settings.defaults, stageGates: { planning: 'approval' } },
    });
    expect(result.success).toBe(false);
  });

  describe('update patch', () => {
    it('accepts one field of one section without filling in the others', () => {
      expect(SettingsPatchSchema.parse({ ui: { collapsedLanes: ['qa'] } })).toEqual({ ui: { collapsedLanes: ['qa'] } });
      expect(SettingsPatchSchema.parse({ defaults: { model: 'sonnet' } })).toEqual({ defaults: { model: 'sonnet' } });
    });

    it('refuses unknown sections and unknown fields', () => {
      expect(SettingsPatchSchema.safeParse({ theme: 'dark' }).success).toBe(false);
      expect(SettingsPatchSchema.safeParse({ ui: { zoom: 2 } }).success).toBe(false);
      expect(SettingsPatchSchema.safeParse({ defaults: { pat: 'x' } }).success).toBe(false);
    });

    it('refuses the version and out-of-range values', () => {
      expect(SettingsPatchSchema.safeParse({ version: 3 }).success).toBe(false);
      expect(SettingsPatchSchema.safeParse({ buildQueueSize: 0 }).success).toBe(false);
      expect(SettingsPatchSchema.safeParse({ buildQueueSize: 1.5 }).success).toBe(false);
      expect(SettingsPatchSchema.safeParse({ repos: [{ ...repo, maxConcurrentAgents: 0 }] }).success).toBe(false);
      expect(SettingsPatchSchema.safeParse({ defaults: { effort: 'extreme' } }).success).toBe(false);
    });
  });

  it('declares both channels', () => {
    expect(Object.keys(settingsInvokeContracts).sort()).toEqual(['settings:get', 'settings:update']);
  });
});
