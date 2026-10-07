import { reportError } from '@/shared/api';

/** An error thrown in a loop (an animation frame, a timer) must not flood the log. */
const MAX_REPORTS_PER_MINUTE = 30;
const MINUTE_MS = 60_000;

/**
 * Sends errors nothing caught (`window.onerror`) and unhandled promise rejections to the
 * main-process log (AL-214). Render errors are reported by the error boundaries instead.
 * Returns a function that removes the listeners.
 */
export function installErrorReporting(target: Window = window, now: () => number = Date.now): () => void {
  let windowStart = -Infinity;
  let reported = 0;

  function allow(): boolean {
    const time = now();
    if (time - windowStart >= MINUTE_MS) {
      windowStart = time;
      reported = 0;
    }
    reported += 1;
    return reported <= MAX_REPORTS_PER_MINUTE;
  }

  const onError = (event: ErrorEvent) => {
    if (allow()) void reportError('window', event.error ?? event.message);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    if (allow()) void reportError('promise', event.reason);
  };

  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
  };
}
