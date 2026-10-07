import { EVENT_CHANNEL_NAMES, type AgentLanesBridge, type EventChannel, type InvokeChannel } from '@agent-lanes/contracts';
import { vi } from 'vitest';

type Replies = Partial<Record<InvokeChannel, unknown>>;
type Listener = (payload: unknown) => void;

export interface FakeBridge extends AgentLanesBridge {
  /** Delivers a payload to every listener on the channel, as main's `emit` does through the preload. */
  emit(channel: EventChannel, payload: unknown): void;
  /** How many listeners are subscribed to the channel right now. */
  listenerCount(channel: EventChannel): number;
}

/**
 * Installs a fake `window.agentLanes` that answers each invoke channel with a canned reply and lets
 * tests push events. Like the preload, `on` throws for unknown channels and returns an unsubscribe.
 */
export function installFakeBridge(replies: Replies = {}): FakeBridge {
  const eventChannels = new Set<string>(EVENT_CHANNEL_NAMES);
  const listeners = new Map<EventChannel, Set<Listener>>();

  const bridge: FakeBridge = {
    invoke: vi.fn(async (channel: InvokeChannel) => replies[channel] ?? { ok: false, code: 'INTERNAL', message: 'no fake reply' }),
    on: vi.fn((channel: EventChannel, listener: Listener) => {
      if (!eventChannels.has(channel)) throw new Error(`Unknown event channel ${String(channel)}`);
      const forChannel = listeners.get(channel) ?? new Set<Listener>();
      listeners.set(channel, forChannel);
      // A fresh wrapper per call, so subscribing the same function twice gives two subscriptions, as ipcRenderer does.
      const subscription: Listener = (payload) => listener(payload);
      forChannel.add(subscription);
      return () => {
        forChannel.delete(subscription);
      };
    }),
    emit(channel, payload) {
      for (const listener of [...(listeners.get(channel) ?? [])]) listener(payload);
    },
    listenerCount(channel) {
      return listeners.get(channel)?.size ?? 0;
    },
  };
  window.agentLanes = bridge;
  return bridge;
}
