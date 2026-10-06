/**
 * Channel names only, with no zod import, so the sandboxed preload can build its
 * allow-list without bundling the schemas.
 *
 * Each domain owns its names in `domains/<domain>.names.ts` and its schemas in
 * `domains/<domain>.schemas.ts`; add channels there, not here. The `satisfies` checks in
 * the schema files fail the build if a name has no contract.
 */
import { ADO_EVENT_CHANNELS, ADO_INVOKE_CHANNELS } from './domains/ado.names';
import { AGENT_EVENT_CHANNELS, AGENT_INVOKE_CHANNELS } from './domains/agent.names';
import { APP_EVENT_CHANNELS, APP_INVOKE_CHANNELS } from './domains/app.names';
import { BUILD_EVENT_CHANNELS, BUILD_INVOKE_CHANNELS } from './domains/build.names';
import { CONNECTIONS_EVENT_CHANNELS, CONNECTIONS_INVOKE_CHANNELS } from './domains/connections.names';
import { DESIGN_EVENT_CHANNELS, DESIGN_INVOKE_CHANNELS } from './domains/design.names';
import { GIT_EVENT_CHANNELS, GIT_INVOKE_CHANNELS } from './domains/git.names';
import { REPOS_EVENT_CHANNELS, REPOS_INVOKE_CHANNELS } from './domains/repos.names';
import { SETTINGS_EVENT_CHANNELS, SETTINGS_INVOKE_CHANNELS } from './domains/settings.names';
import { TICKETS_EVENT_CHANNELS, TICKETS_INVOKE_CHANNELS } from './domains/tickets.names';

export * from './domains/ado.names';
export * from './domains/agent.names';
export * from './domains/app.names';
export * from './domains/build.names';
export * from './domains/connections.names';
export * from './domains/design.names';
export * from './domains/git.names';
export * from './domains/repos.names';
export * from './domains/settings.names';
export * from './domains/tickets.names';

export const INVOKE_CHANNEL_NAMES = [
  ...APP_INVOKE_CHANNELS,
  ...SETTINGS_INVOKE_CHANNELS,
  ...CONNECTIONS_INVOKE_CHANNELS,
  ...ADO_INVOKE_CHANNELS,
  ...REPOS_INVOKE_CHANNELS,
  ...GIT_INVOKE_CHANNELS,
  ...TICKETS_INVOKE_CHANNELS,
  ...AGENT_INVOKE_CHANNELS,
  ...BUILD_INVOKE_CHANNELS,
  ...DESIGN_INVOKE_CHANNELS,
] as const;
export type InvokeChannel = (typeof INVOKE_CHANNEL_NAMES)[number];

export const EVENT_CHANNEL_NAMES = [
  ...APP_EVENT_CHANNELS,
  ...SETTINGS_EVENT_CHANNELS,
  ...CONNECTIONS_EVENT_CHANNELS,
  ...ADO_EVENT_CHANNELS,
  ...REPOS_EVENT_CHANNELS,
  ...GIT_EVENT_CHANNELS,
  ...TICKETS_EVENT_CHANNELS,
  ...AGENT_EVENT_CHANNELS,
  ...BUILD_EVENT_CHANNELS,
  ...DESIGN_EVENT_CHANNELS,
] as const;
export type EventChannel = (typeof EVENT_CHANNEL_NAMES)[number];

/** The object the preload exposes on `window.agentLanes`. Payloads are validated on both ends. */
export interface AgentLanesBridge {
  invoke(channel: InvokeChannel, payload?: unknown): Promise<unknown>;
  on(channel: EventChannel, listener: (payload: unknown) => void): () => void;
}
