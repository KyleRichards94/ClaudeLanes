import {
  SettingsPatchSchema,
  defaultSettings,
  type AgentLanesBridge,
  type InvokeChannel,
  type Settings,
} from '@agent-lanes/contracts';
import { vi } from 'vitest';
import { installFakeBridge } from './bridge';

export interface FakeSettings {
  /** What the fake main process holds now. */
  readonly settings: Settings;
  /** Every `settings:update` payload, in order. */
  readonly updates: unknown[];
  readonly bridge: AgentLanesBridge;
}

/**
 * Installs a fake bridge whose `settings:get` and `settings:update` behave like the main process:
 * updates are validated and merged, and later reads see them. Other channels answer from `replies`.
 */
export function installFakeSettings(
  initial: Settings = defaultSettings(),
  replies: Partial<Record<InvokeChannel, unknown>> = {},
): FakeSettings {
  let settings = structuredClone(initial);
  const updates: unknown[] = [];
  const bridge = installFakeBridge(replies);
  const otherChannels = bridge.invoke;

  bridge.invoke = vi.fn(async (channel: InvokeChannel, payload?: unknown) => {
    if (channel === 'settings:get') return { ok: true, data: structuredClone(settings) };
    if (channel !== 'settings:update') return otherChannels(channel, payload);

    updates.push(payload);
    const patch = SettingsPatchSchema.safeParse(payload);
    if (!patch.success) return { ok: false, code: 'VALIDATION', message: 'Invalid settings update' };
    const {
      repos = settings.repos,
      buildQueueSize = settings.buildQueueSize,
      adoStateTransitions = settings.adoStateTransitions,
      defaults,
      ui,
      dropDefaults = settings.dropDefaults,
    } = patch.data;
    settings = {
      ...settings,
      repos,
      buildQueueSize,
      adoStateTransitions,
      defaults: { ...settings.defaults, ...defaults },
      ui: { ...settings.ui, ...ui },
      ...(dropDefaults ? { dropDefaults } : {}),
    };
    return { ok: true, data: structuredClone(settings) };
  });

  return {
    get settings() {
      return settings;
    },
    updates,
    bridge,
  };
}
