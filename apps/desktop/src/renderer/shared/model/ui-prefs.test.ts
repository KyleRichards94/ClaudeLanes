import { defaultSettings, defaultUiPrefs } from '@agent-lanes/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUiPrefsStorage } from '@/shared/api';
import { installFakeBridge, installFakeSettings } from '@/shared/testing';
import { createUiPrefsStore, hydrateUiPrefs } from './ui-prefs';

function newStore() {
  return createUiPrefsStore(createUiPrefsStorage());
}

describe('UI prefs store', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts on the defaults and does not touch the main process until hydrated', () => {
    const main = installFakeSettings();
    const store = newStore();

    expect(store.getState()).toMatchObject(defaultUiPrefs());
    expect(main.bridge.invoke).not.toHaveBeenCalled();
  });

  it('hydrates from the settings in the main process', async () => {
    installFakeSettings({
      ...defaultSettings(),
      ui: { lastRepo: 'C:/src/osc', lastSprint: 'sprint-42', collapsedLanes: ['queued'], embedModeByTicket: { '71273': 'mcp-link' } },
    });
    const store = newStore();
    await hydrateUiPrefs(store);

    expect(store.persist.hasHydrated()).toBe(true);
    expect(store.getState()).toMatchObject({
      lastRepo: 'C:/src/osc',
      lastSprint: 'sprint-42',
      collapsedLanes: ['queued'],
      embedModeByTicket: { '71273': 'mcp-link' },
    });
  });

  it('keeps collapsed lanes across a restart', async () => {
    const main = installFakeSettings();
    const before = newStore();
    await hydrateUiPrefs(before);

    before.getState().toggleLane('qa');
    before.getState().toggleLane('done');
    await vi.waitFor(() => expect(main.settings.ui.collapsedLanes).toEqual(['qa']));

    const afterRestart = newStore();
    await hydrateUiPrefs(afterRestart);
    expect(afterRestart.getState().collapsedLanes).toEqual(['qa']);
  });

  it('saves only the prefs, never the actions', async () => {
    const main = installFakeSettings();
    const store = newStore();
    await hydrateUiPrefs(store);

    store.getState().setLastRepo('C:/src/osc');
    await vi.waitFor(() => expect(main.updates).toHaveLength(1));
    expect(main.updates[0]).toEqual({ ui: { ...defaultUiPrefs(), lastRepo: 'C:/src/osc' } });
  });

  it('sets a lane collapsed or open without listing it twice', () => {
    installFakeSettings();
    const store = newStore();

    store.getState().setLaneCollapsed('qa', true);
    store.getState().setLaneCollapsed('qa', true);
    expect(store.getState().collapsedLanes).toEqual(['done', 'qa']);

    store.getState().setLaneCollapsed('done', false);
    expect(store.getState().collapsedLanes).toEqual(['qa']);
  });

  it('remembers the embed mode per ticket and the last sprint', () => {
    installFakeSettings();
    const store = newStore();

    store.getState().setEmbedMode('71273', 'mcp-link');
    store.getState().setEmbedMode('71330', 'webview');
    store.getState().setLastSprint('sprint-43');

    expect(store.getState()).toMatchObject({
      lastSprint: 'sprint-43',
      embedModeByTicket: { '71273': 'mcp-link', '71330': 'webview' },
    });
  });

  it('finishes hydrating on the defaults when the main process cannot answer', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installFakeBridge({ 'settings:get': { ok: false, code: 'INTERNAL', message: 'down' } });
    const store = newStore();
    await hydrateUiPrefs(store);

    expect(store.persist.hasHydrated()).toBe(true);
    expect(store.getState().collapsedLanes).toEqual(['done']);
  });
});
