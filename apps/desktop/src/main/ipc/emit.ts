import { z } from 'zod';
import { eventContracts, type EventChannel, type EventInput } from '@agent-lanes/contracts';
import type { RendererLocation } from './router';
import { isTrustedSenderUrl } from './trusted-sender';

/** Pushes a typed event to the renderer. Services receive this instead of the window (design §6). */
export type Emit = <C extends EventChannel>(channel: C, payload: EventInput<C>) => void;

/** The part of Electron's `WebFrameMain` that events need; the main window's top frame in the app. */
export interface EventFrame {
  readonly url: string;
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
}

export interface EmitterOptions {
  /** The main window's top frame, or undefined while there is no window. Read on every emit. */
  frame: () => EventFrame | undefined;
  /** Where our renderer lives; a frame showing anything else gets no events. */
  renderer: RendererLocation;
  /** Throw on an invalid payload (development) instead of logging and dropping it (production). */
  strict: boolean;
  /** Where dropped events are reported. Defaults to `console.error`. */
  log?: (message: string, issues?: unknown) => void;
}

/**
 * Creates `emit(channel, payload)`, the main process's only way to push to the renderer.
 *
 * - The payload is parsed with its contract from packages/contracts, and the parsed copy is what is
 *   sent: fields a contract doesn't declare are stripped, so a token passed by mistake never crosses
 *   IPC (design §8). `at` is stamped with the current time when the caller leaves it out.
 * - An invalid payload throws when `strict` (development) and is logged and dropped otherwise.
 *   Zod issues carry paths and messages, not the rejected values, so logs don't echo payload data.
 * - Events go to the main window's top frame only, and only while it shows our renderer (the same
 *   check as invoke's trusted sender). Other windows, sub-frames and views such as Claude Design
 *   never receive them. With no window, or while the page is still loading, the event is dropped;
 *   renderers backfill state over invoke (e.g. `agent:getTranscript`, AL-102).
 */
export function createEmitter(options: EmitterOptions): Emit {
  const log = options.log ?? ((message, issues) => console.error(`[events] ${message}`, issues ?? ''));

  return (channel, payload) => {
    const contract = eventContracts[channel] as z.ZodType | undefined;
    if (!contract) {
      return reject(`Unknown event channel ${String(channel)}`);
    }

    const parsed = contract.safeParse(payload);
    if (!parsed.success) {
      return reject(`Invalid payload for ${channel}:\n${z.prettifyError(parsed.error)}`, parsed.error);
    }

    const frame = options.frame();
    if (!frame || frame.isDestroyed()) return;

    // An empty URL means the renderer is still loading; anything else that isn't ours is refused.
    if (!isTrustedSenderUrl(frame.url, options.renderer.url, options.renderer.file)) {
      if (frame.url) log(`Refused ${channel} for an untrusted frame`);
      return;
    }

    frame.send(channel, parsed.data);
  };

  function reject(message: string, error?: z.ZodError): void {
    if (options.strict) throw new Error(message, { cause: error });
    log(`Dropped an event. ${message}`, error?.issues);
  }
}
