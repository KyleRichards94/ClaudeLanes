import type { EventChannel, EventPayload } from '@agent-lanes/contracts';

/**
 * High-rate channels the app's event hub (AL-015) hands to stores at most once per animation frame,
 * as one batch (design §12 Performance). Every other channel is delivered as each event arrives.
 */
export const BATCHED_EVENT_CHANNELS = ['agent:output', 'build:log'] as const satisfies readonly EventChannel[];
export type BatchedEventChannel = (typeof BATCHED_EVENT_CHANNELS)[number];

/**
 * A store's handler for one event channel. A batched channel's handler gets every valid event since
 * the last frame, in arrival order, so it can commit them in one store update; any other channel's
 * handler gets one validated event at a time.
 */
export type EventHandler<C extends EventChannel> = C extends BatchedEventChannel
  ? (events: readonly EventPayload<C>[]) => void
  : (event: EventPayload<C>) => void;

/**
 * The handlers one store registers with the event hub, by channel. An entity slice exports one of
 * these (e.g. `{ 'agent:output': onAgentOutput, 'agent:stage': onStage }`) and `app/` registers it.
 */
export type EventHandlers = { readonly [C in EventChannel]?: EventHandler<C> };
