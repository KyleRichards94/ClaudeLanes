import { join } from 'node:path';
import { SETTINGS_VERSION, defaultSettings, type Settings, type SettingsPatch } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createRepoSettings } from './repo-settings';
import { createSettingsService } from './service';
import { createMemorySettingsFile, type SettingsFile } from './settings-file';

const repoPath = join('C:', 'src', 'onsite-companion');

function start(stored?: unknown) {
  const file = createMemorySettingsFile(stored);
  const warn = vi.fn();
  return { file, warn, service: createSettingsService({ file, warn }) };
}

describe('SettingsService', () => {
  it('starts a fresh profile on the defaults without writing a file', () => {
    const { service, file, warn } = start();
    expect(service.get()).toEqual(defaultSettings());
    expect(file.writes).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it('keeps collapsed lanes across a restart', () => {
    const { service, file } = start();
    service.update({ ui: { collapsedLanes: ['qa', 'done'] } });

    const restarted = createSettingsService({ file, warn: vi.fn() });
    expect(restarted.get().ui.collapsedLanes).toEqual(['qa', 'done']);
  });

  it('changes only the fields a patch names', () => {
    const { service, file } = start();
    const result = service.update({ ui: { lastSprint: 'sprint-42' }, defaults: { model: 'haiku' } });

    const expected: Settings = {
      ...defaultSettings(),
      defaults: { ...defaultSettings().defaults, model: 'haiku' },
      ui: { ...defaultSettings().ui, lastSprint: 'sprint-42' },
    };
    expect(result).toEqual({ ok: true, data: expected });
    expect(service.get()).toEqual(expected);
    expect(file.contents).toEqual(expected);
  });

  it('replaces arrays and records whole', () => {
    const { service } = start();
    service.update({ ui: { collapsedLanes: ['qa'], embedModeByTicket: { '71273': 'mcp-link' } } });
    service.update({ ui: { embedModeByTicket: { '71330': 'webview' } } });

    expect(service.get().ui).toMatchObject({ collapsedLanes: ['qa'], embedModeByTicket: { '71330': 'webview' } });
  });

  it('stores repos with their overrides', () => {
    const { service } = start();
    const repo = createRepoSettings(repoPath, { buildCommand: 'dotnet build OnSite.sln -c Debug', maxConcurrentAgents: 2 });
    const result = service.update({ repos: [repo], ui: { lastRepo: repoPath } });

    expect(result.ok).toBe(true);
    expect(service.get().repos).toEqual([repo]);
  });

  it('ignores fields sent as undefined', () => {
    const { service } = start();
    service.update({ ui: { lastRepo: repoPath } });
    const result = service.update({ ui: { lastRepo: undefined, lastSprint: 'sprint-42' } });

    expect(result.ok && result.data.ui).toMatchObject({ lastRepo: repoPath, lastSprint: 'sprint-42' });
  });

  it.each<[string, unknown]>([
    ['an unknown field', { ui: { zoom: 2 } }],
    ['an unknown section', { connections: [] }],
    ['a value out of range', { buildQueueSize: 99 }],
    ['an unknown lane', { ui: { collapsedLanes: ['backlog'] } }],
    ['the same repo twice', { repos: [createRepoSettings(repoPath), createRepoSettings(repoPath)] }],
  ])('refuses %s and changes nothing', (_name, patch) => {
    const { service, file } = start();
    const result = service.update(patch as SettingsPatch);

    expect(!result.ok && result.code).toBe('VALIDATION');
    expect(service.get()).toEqual(defaultSettings());
    expect(file.writes).toBe(0);
  });

  it('reports a failed save and keeps the previous settings', () => {
    const file: SettingsFile = {
      location: 'C:/profile/settings.json',
      read: () => undefined,
      write: () => {
        throw new Error('EPERM: operation not permitted');
      },
    };
    const service = createSettingsService({ file, warn: vi.fn() });
    const result = service.update({ buildQueueSize: 3 });

    expect(!result.ok && result.code).toBe('INTERNAL');
    expect(!result.ok && result.message).toContain('EPERM');
    expect(service.get().buildQueueSize).toBe(2);
  });

  it('hands out copies, so callers cannot change settings behind its back', () => {
    const { service } = start();
    service.get().ui.collapsedLanes.push('qa');
    const result = service.update({ buildQueueSize: 3 });

    expect(service.get().ui.collapsedLanes).toEqual(['done']);
    if (result.ok) result.data.ui.collapsedLanes.push('qa');
    expect(service.get().ui.collapsedLanes).toEqual(['done']);
  });

  describe('loading a damaged file', () => {
    it('keeps the valid values and resets each invalid one to its default', () => {
      const { service, warn } = start({
        version: SETTINGS_VERSION,
        buildQueueSize: 'lots',
        defaults: { model: 'sonnet', effort: 'turbo' },
        ui: { lastRepo: repoPath, collapsedLanes: ['qa', 'backlog'] },
      });

      const defaults = defaultSettings();
      expect(service.get()).toEqual({
        ...defaults,
        defaults: { ...defaults.defaults, model: 'sonnet' },
        ui: { ...defaults.ui, lastRepo: repoPath },
      });
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toContain('defaults.effort, buildQueueSize, ui.collapsedLanes');
    });

    it('keeps repos with a usable path, filling fields they lack, and drops the rest', () => {
      const other = join('C:', 'src', 'agent-lanes');
      const { service } = start({
        version: SETTINGS_VERSION,
        repos: [{ path: repoPath, name: 'OSC', baseBranch: 'develop' }, { name: 'no path' }, { path: repoPath }, { path: other, maxConcurrentAgents: -1 }],
      });

      expect(service.get().repos).toEqual([
        createRepoSettings(repoPath, { name: 'OSC', baseBranch: 'develop' }),
        createRepoSettings(other),
      ]);
    });

    it.each<[string, unknown]>([
      ['a list', [1, 2, 3]],
      ['a string', 'settings'],
      ['an unversioned document', { ui: 'collapsed' }],
    ])('falls back to the defaults for %s', (_name, stored) => {
      const { service, warn } = start(stored);
      expect(service.get()).toEqual(defaultSettings());
      expect(warn).toHaveBeenCalledOnce();
    });

    it('reads a newer version as the current one and leaves the file alone until the next save', () => {
      const { service, file } = start({ version: SETTINGS_VERSION + 1, buildQueueSize: 4, futureField: true });
      expect(service.get().buildQueueSize).toBe(4);
      expect(file.writes).toBe(0);
    });

    it('starts on the defaults when the file cannot be read', () => {
      const warn = vi.fn();
      const file: SettingsFile = {
        location: 'C:/profile/settings.json',
        read: () => {
          throw new Error('EBUSY: resource busy or locked');
        },
        write: vi.fn(),
      };
      const service = createSettingsService({ file, warn });

      expect(service.get()).toEqual(defaultSettings());
      expect(warn.mock.calls[0]?.[0]).toContain('EBUSY');
    });
  });
});
