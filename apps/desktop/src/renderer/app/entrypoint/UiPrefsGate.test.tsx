import { render, screen } from '@testing-library/react';
import { Text } from 'react-native';
import { defaultSettings } from '@agent-lanes/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEmbedMode, useLaneCollapsed } from '@/shared/model';
import { installFakeBridge, installFakeSettings } from '@/shared/testing';
import { UiPrefsGate } from './UiPrefsGate';

function Probe() {
  const qaCollapsed = useLaneCollapsed('qa');
  const embedMode = useEmbedMode('71273');
  return <Text>{`QA ${qaCollapsed ? 'collapsed' : 'open'} · ${embedMode}`}</Text>;
}

describe('UiPrefsGate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the app once the saved prefs are loaded, never with the defaults first', async () => {
    installFakeSettings({
      ...defaultSettings(),
      ui: { ...defaultSettings().ui, collapsedLanes: ['qa'], embedModeByTicket: { '71273': 'mcp-link' } },
    });
    render(
      <UiPrefsGate>
        <Probe />
      </UiPrefsGate>,
    );

    expect(screen.queryByText(/^QA/)).toBeNull();
    expect(await screen.findByText('QA collapsed · mcp-link')).toBeTruthy();
  });

  it('still renders the app when the prefs cannot be loaded', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installFakeBridge({ 'settings:get': { ok: false, code: 'INTERNAL', message: 'down' } });
    render(
      <UiPrefsGate>
        <Text>Agent board</Text>
      </UiPrefsGate>,
    );

    expect(await screen.findByText('Agent board')).toBeTruthy();
  });
});
