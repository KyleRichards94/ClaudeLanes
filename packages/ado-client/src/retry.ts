/** Statuses Azure DevOps uses for throttling and short outages; both mean "try again later". */
export const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 503]);

export interface RetryPolicy {
  /** Retries after the first attempt (ticket AL-060: max 3). */
  maxRetries: number;
  /** Backoff when the response has no `Retry-After`: base, 2×base, 4×base, … */
  baseDelayMs: number;
  /** Longest wait the client accepts. A longer `Retry-After` ends the call instead of blocking it. */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 30_000 };

/**
 * `Retry-After` as milliseconds: delta-seconds (`"5"`, `"1.5"`) or an HTTP date. Undefined when the
 * header is missing or unreadable; never negative.
 */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  if (value === '') return undefined;
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 1_000);
  // HTTP dates always name the month; this keeps V8's lenient Date.parse from reading "-1" as a year.
  if (!/[a-z]{3}/i.test(value)) return undefined;
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

/** Wait before retry number `retry` (1-based): the server's `Retry-After`, else exponential backoff. */
export function retryDelay(retry: number, retryAfterMs: number | undefined, policy: RetryPolicy): number {
  return retryAfterMs ?? policy.baseDelayMs * 2 ** (retry - 1);
}

/** Resolves after `ms`, or rejects with the signal's reason as soon as it aborts. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
