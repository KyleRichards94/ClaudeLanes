import { EVENT_CHANNEL_NAMES, type EventChannel } from '@agent-lanes/contracts';
import { BATCHED_EVENT_CHANNELS, subscribe, type BatchedEventChannel, type EventHandlers } from '@/shared/api';
import { appEventHandlers } from './event-routes';

/**
 * How long a batch waits for an animation frame before it is handed over anyway. Chromium pauses
 * frames while the window is minimised or hidden; this keeps stores current then, without growing
 * the buffer until the window comes back (hidden pages run timers about once a second at most).
 */
export const HIDDEN_FLUSH_DELAY_MS = 250;

/**
 * The renderer's single route from main → renderer events into the stores (design §6 Live events).
 *
 * - Subscribes once to every event channel through `subscribe` from `@/shared/api`, which validates
 *   each payload against its contract and logs and drops one that breaks it.
 * - High-rate channels (`BATCHED_EVENT_CHANNELS`: `agent:output`, `build:log`) are buffered and
 *   handed to their handlers as one batch per animation frame (design §12 Performance); every other
 *   channel goes to its handlers as each event arrives. Order is kept within a channel, not across a
 *   batched and an unbatched one; events carry `at` for that.
 * - A handler that throws is logged; the other handlers and later events still get through.
 */
export interface EventHub {
  /** Subscribes once to every event channel. Calling it again does nothing. */
  start(): void;
  /** Adds one store's handlers. Never touches the bridge. Returns a function that removes them. */
  register(handlers: EventHandlers): () => void;
  /** Hands buffered batches to their handlers now instead of on the next frame. */
  flush(): void;
  /** Unsubscribes from every channel and drops buffered events. Registered handlers stay. */
  stop(): void;
}

type Handler = (eventOrBatch: unknown) => void;

/** One registered handler. An object per registration, so the same function can be registered twice. */
interface Registration {
  readonly handle: Handler;
}

const batchedChannels = new Set<EventChannel>(BATCHED_EVENT_CHANNELS);

function isBatched(channel: EventChannel): channel is BatchedEventChannel {
  return batchedChannels.has(channel);
}

/** Runs `flush` on the next animation frame, or after HIDDEN_FLUSH_DELAY_MS if no frame comes first. */
function scheduleNextFrame(flush: () => void): () => void {
  const frame = requestAnimationFrame(flush);
  const timer = setTimeout(flush, HIDDEN_FLUSH_DELAY_MS);
  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(timer);
  };
}

export function createEventHub(): EventHub {
  const handlers = new Map<EventChannel, Set<Registration>>();
  const pending = new Map<BatchedEventChannel, unknown[]>();
  let unsubscribes: (() => void)[] | undefined;
  let cancelScheduledFlush: (() => void) | undefined;

  function deliver(channel: EventChannel, registrations: ReadonlySet<Registration>, value: unknown) {
    // A copy, so a handler that registers or unregisters during delivery doesn't change this round.
    for (const registration of [...registrations]) {
      try {
        registration.handle(value);
      } catch (error) {
        console.error(`An ${channel} event handler failed`, error);
      }
    }
  }

  function receive(channel: EventChannel, payload: unknown) {
    const registrations = handlers.get(channel);
    // Nothing is buffered for a channel no store listens to.
    if (!registrations?.size) return;

    if (!isBatched(channel)) {
      deliver(channel, registrations, payload);
      return;
    }

    const batch = pending.get(channel);
    if (batch) batch.push(payload);
    else pending.set(channel, [payload]);
    cancelScheduledFlush ??= scheduleNextFrame(flush);
  }

  function flush() {
    cancelScheduledFlush?.();
    cancelScheduledFlush = undefined;
    if (pending.size === 0) return;

    const batches = [...pending];
    pending.clear();
    for (const [channel, events] of batches) {
      const registrations = handlers.get(channel);
      if (registrations) deliver(channel, registrations, events);
    }
  }

  return {
    start() {
      if (unsubscribes) return;
      unsubscribes = EVENT_CHANNEL_NAMES.map((channel) => subscribe(channel, (payload) => receive(channel, payload)));
    },

    register(map) {
      const added: [EventChannel, Registration][] = [];
      for (const channel of EVENT_CHANNEL_NAMES) {
        const handle = map[channel];
        if (!handle) continue;
        const registration: Registration = { handle: handle as Handler };
        const registrations = handlers.get(channel) ?? new Set<Registration>();
        handlers.set(channel, registrations);
        registrations.add(registration);
        added.push([channel, registration]);
      }
      return () => {
        for (const [channel, registration] of added) handlers.get(channel)?.delete(registration);
      };
    },

    flush,

    stop() {
      cancelScheduledFlush?.();
      cancelScheduledFlush = undefined;
      pending.clear();
      for (const unsubscribe of unsubscribes ?? []) unsubscribe();
      unsubscribes = undefined;
    },
  };
}

let appEventHub: EventHub | undefined;

/**
 * Starts the app's one event hub with the stores' handlers (`event-routes.ts`). Called once at
 * start-up, before the first render; a second call returns the same hub, so each channel keeps
 * exactly one bridge subscription for the renderer's lifetime.
 */
export function startEventHub(): EventHub {
  if (!appEventHub) {
    const hub = createEventHub();
    for (const handlers of appEventHandlers) hub.register(handlers);
    hub.start();
    appEventHub = hub;
  }
  return appEventHub;
}

/** Stops the app's hub and forgets it, so the next `startEventHub` subscribes again (tests). */
export function stopEventHub(): void {
  appEventHub?.stop();
  appEventHub = undefined;
}

/** The app's hub once `startEventHub` ran, else undefined (tests that render without starting it). */
export function runningEventHub(): EventHub | undefined {
  return appEventHub;
}
