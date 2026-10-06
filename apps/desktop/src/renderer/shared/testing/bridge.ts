import type { AgentLanesBridge, InvokeChannel } from '@agent-lanes/contracts';
import { vi } from 'vitest';

type Replies = Partial<Record<InvokeChannel, unknown>>;

/** Installs a fake `window.agentLanes` that answers each channel with a canned reply. */
export function installFakeBridge(replies: Replies): AgentLanesBridge {
  const bridge: AgentLanesBridge = {
    invoke: vi.fn(async (channel: InvokeChannel) => replies[channel] ?? { ok: false, code: 'INTERNAL', message: 'no fake reply' }),
    on: vi.fn(() => () => undefined),
  };
  window.agentLanes = bridge;
  return bridge;
}
