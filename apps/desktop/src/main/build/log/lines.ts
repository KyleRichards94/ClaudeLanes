import { StringDecoder } from 'node:string_decoder';
import { BUILD_LOG_BATCH_MAX, BUILD_LOG_LINE_MAX } from '@agent-lanes/contracts';

/** Cuts a line to BUILD_LOG_LINE_MAX characters, ending in `…` when it was longer. */
export function clampLine(text: string): string {
  return text.length > BUILD_LOG_LINE_MAX ? `${text.slice(0, BUILD_LOG_LINE_MAX - 1)}…` : text;
}

/** Longest stretch without a line break that is kept before it is let out as a line of its own. */
const PENDING_MAX = 64 * 1024;

export interface LineSplitter {
  /** A chunk of a child process's output; UTF-8 characters split across chunks are joined. */
  write(chunk: Buffer | string): void;
  /** Lets out the last line when the stream ends without a line break. */
  end(): void;
}

/**
 * Turns a stream's chunks into lines: `\n`, `\r\n` and a lone `\r` (progress redraws) all end a
 * line, and a very long stretch without one is let out in pieces so memory stays bounded.
 */
export function createLineSplitter(onLine: (line: string) => void): LineSplitter {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  /** The previous chunk ended in `\r`: a `\n` starting the next one belongs to it. */
  let afterCarriageReturn = false;

  function take(text: string): void {
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === '\n' && afterCarriageReturn && i === start && pending === '') {
        afterCarriageReturn = false;
        start = i + 1;
        continue;
      }
      afterCarriageReturn = false;
      if (char !== '\n' && char !== '\r') continue;
      onLine(pending + text.slice(start, i));
      pending = '';
      if (char === '\r') {
        if (text[i + 1] === '\n') i += 1;
        else if (i === text.length - 1) afterCarriageReturn = true;
      }
      start = i + 1;
    }
    pending += text.slice(start);
    while (pending.length > PENDING_MAX) {
      onLine(pending.slice(0, PENDING_MAX));
      pending = pending.slice(PENDING_MAX);
    }
  }

  return {
    write(chunk) {
      take(typeof chunk === 'string' ? chunk : decoder.write(chunk));
    },
    end() {
      take(decoder.end());
      if (pending) onLine(pending);
      pending = '';
    },
  };
}

export interface Batcher<T> {
  push(item: T): void;
  /** Sends what is waiting now and stops the timer. */
  flush(): void;
}

export interface BatcherOptions<T> {
  send(items: T[]): void;
  /** Longest an item waits before its batch is sent. */
  intervalMs?: number;
  /** A batch is sent at once when it reaches this size. */
  maxItems?: number;
}

export const DEFAULT_LOG_BATCH_MS = 100;

/**
 * Groups log lines into batches so a build printing thousands of lines a second sends about ten
 * `build:log` events a second, not one per line (AL-132).
 */
export function createBatcher<T>({ send, intervalMs = DEFAULT_LOG_BATCH_MS, maxItems = BUILD_LOG_BATCH_MAX }: BatcherOptions<T>): Batcher<T> {
  let items: T[] = [];
  let timer: NodeJS.Timeout | null = null;

  function flush(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    if (items.length === 0) return;
    const batch = items;
    items = [];
    send(batch);
  }

  return {
    push(item) {
      items.push(item);
      if (items.length >= maxItems) flush();
      else timer ??= setTimeout(flush, intervalMs);
    },
    flush,
  };
}
