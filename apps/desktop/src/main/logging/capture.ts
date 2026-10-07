import { ORIGINAL_CONSOLE_METHOD, type ConsoleLike, type Logger } from './logger';

type Method = 'warn' | 'error';
const CAPTURED: readonly Method[] = ['warn', 'error'];

/**
 * Copies every `console.warn` and `console.error` in the main process into the log (scope `console`),
 * redacted, while still printing them as before. Services that default to the console (the secret
 * store, the settings store, libraries) land in the log without each one being wired to it.
 * `console.log`/`info`/`debug` are left alone: libraries are chatty there.
 *
 * Returns a function that puts the original methods back.
 */
export function captureConsole(log: Logger, target: ConsoleLike = console): () => void {
  const sink = log.child('console', { mirror: false });
  const originals = new Map<Method, ConsoleLike[Method]>();

  for (const method of CAPTURED) {
    const original = target[method];
    originals.set(method, original);
    const replacement = Object.assign(
      (...args: unknown[]) => {
        original.apply(target, args);
        sink.log(method, ...splitArgs(args));
      },
      { [ORIGINAL_CONSOLE_METHOD]: original },
    );
    target[method] = replacement;
  }

  return () => {
    for (const [method, original] of originals) target[method] = original;
  };
}

/** `console.error('Failed to load', err)` → message "Failed to load", detail err (stack and all). */
function splitArgs(args: unknown[]): [message: string, detail?: unknown] {
  const strings: string[] = [];
  const rest: unknown[] = [];
  for (const arg of args) {
    if (rest.length === 0 && (typeof arg === 'string' || typeof arg === 'number' || typeof arg === 'boolean')) strings.push(String(arg));
    else rest.push(arg);
  }
  const message = strings.join(' ') || (rest[0] instanceof Error ? 'Error' : '(no message)');
  if (rest.length === 0) return [message];
  return [message, rest.length === 1 ? rest[0] : rest];
}

/** The part of `process` this module listens on; tests pass an EventEmitter. */
export interface ProcessLike {
  on(event: 'uncaughtExceptionMonitor', listener: (error: Error, origin: string) => void): unknown;
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
  off(event: 'uncaughtExceptionMonitor', listener: (error: Error, origin: string) => void): unknown;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): unknown;
}

/**
 * Logs uncaught exceptions and unhandled promise rejections in the main process.
 *
 * - Exceptions use `uncaughtExceptionMonitor`, which observes without changing what happens next
 *   (Electron's own crash handling still runs), and the line is on disk before that because writes
 *   are synchronous.
 * - Rejections get a listener, so an unhandled rejection is logged as an error instead of ending the
 *   process: one forgotten `await` in a service must not close every agent's lane.
 */
export function captureProcessErrors(log: Logger, target: ProcessLike = process): () => void {
  const sink = log.child('process');
  const onException = (error: Error, origin: string) => {
    sink.error(origin === 'unhandledRejection' ? 'Unhandled promise rejection' : 'Uncaught exception', error);
  };
  const onRejection = (reason: unknown) => {
    sink.error('Unhandled promise rejection', reason);
  };
  target.on('uncaughtExceptionMonitor', onException);
  target.on('unhandledRejection', onRejection);
  return () => {
    target.off('uncaughtExceptionMonitor', onException);
    target.off('unhandledRejection', onRejection);
  };
}
