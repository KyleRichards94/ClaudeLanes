/**
 * Channel names only, with no zod import, so the sandboxed preload can build its
 * allow-list without bundling the schemas. `schemas.ts` must define a contract for
 * every name here; the `satisfies` checks there fail the build if one is missing.
 */
export const INVOKE_CHANNEL_NAMES = ['app:getInfo'] as const;
export type InvokeChannel = (typeof INVOKE_CHANNEL_NAMES)[number];

export const EVENT_CHANNEL_NAMES = [] as const;
export type EventChannel = (typeof EVENT_CHANNEL_NAMES)[number];

/** The object the preload exposes on `window.agentLanes`. Payloads are validated on both ends. */
export interface AgentLanesBridge {
  invoke(channel: InvokeChannel, payload?: unknown): Promise<unknown>;
  on(channel: EventChannel, listener: (payload: unknown) => void): () => void;
}
