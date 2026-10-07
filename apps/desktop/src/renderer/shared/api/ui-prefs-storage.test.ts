import { defaultSettings, defaultUiPrefs, type UiPrefs } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeBridge, installFakeSettings } from '@/shared/testing';
import { createUiPrefsStorage } from './ui-prefs-storage';

const prefs: UiPrefs = {
  lastRepo: 'C:/src/onsite-companion',
  lastSprint: 'sprint-42',
  collapsedLanes: ['qa', 'done'],
  embedModeByTicket: { '71273': 'mcp-link' },
};

describe('createUiPrefsStorage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the ui section of the settings', async () => {
    installFakeSettings({ ...defaultSettings(), ui: prefs });
    await expect(createUiPrefsStorage().getItem('ui-prefs')).resolves.toEqual({ state: prefs });
  });

  it('writes the prefs as a settings:update of the ui section', async () => {
    const main = installFakeSettings();
    await createUiPrefsStorage().setItem('ui-prefs', { state: prefs, version: 0 });

    expect(main.updates).toEqual([{ ui: prefs }]);
    expect(main.settings.ui).toEqual(prefs);
  });

  it('resets the prefs to their defaults when cleared', async () => {
    const main = installFakeSettings({ ...defaultSettings(), ui: prefs });
    await createUiPrefsStorage().removeItem('ui-prefs');
    expect(main.settings.ui).toEqual(defaultUiPrefs());
  });

  it('reads nothing, without throwing, when the main process answers with an error', async () => {
    installFakeBridge({ 'settings:get': { ok: false, code: 'INTERNAL', message: 'down' } });
    await expect(createUiPrefsStorage().getItem('ui-prefs')).resolves.toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('never rejects, even when the bridge itself throws', async () => {
    const bridge = installFakeBridge({});
    vi.mocked(bridge.invoke).mockRejectedValue(new Error('bridge gone'));
    const storage = createUiPrefsStorage();

    await expect(storage.getItem('ui-prefs')).resolves.toBeNull();
    await expect(storage.setItem('ui-prefs', { state: prefs })).resolves.toBeUndefined();
  });

  it('reports a refused write', async () => {
    installFakeBridge({ 'settings:update': { ok: false, code: 'VALIDATION', message: 'Invalid settings update' } });
    await createUiPrefsStorage().setItem('ui-prefs', { state: prefs });
    expect(console.warn).toHaveBeenCalledWith('UI prefs were not saved: Invalid settings update');
  });
});
