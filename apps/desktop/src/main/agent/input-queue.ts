/**
 * The input stream of a streaming-input session (AL-100): the app pushes user turns into it and the
 * Agent SDK reads them as an `AsyncIterable`. Items wait in order until the SDK asks for the next
 * one; `close()` ends the stream after the items already queued.
 */
export interface InputQueue<T> extends AsyncIterable<T> {
  /** Queues an item. Ignored once the queue is closed; returns false then. */
  push(item: T): boolean;
  /** Ends the stream; whatever is still queued is dropped. */
  close(): void;
  readonly closed: boolean;
  /** Items pushed and not yet read by the session. */
  readonly size: number;
}

export function createInputQueue<T>(): InputQueue<T> {
  const items: T[] = [];
  let closed = false;
  let wake: (() => void) | undefined;
  const notify = () => {
    const resolve = wake;
    wake = undefined;
    resolve?.();
  };

  async function* read(): AsyncGenerator<T, void> {
    for (;;) {
      if (closed) return;
      const next = items.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => (wake = resolve));
    }
  }

  return {
    push(item) {
      if (closed) return false;
      items.push(item);
      notify();
      return true;
    },
    close() {
      closed = true;
      items.length = 0;
      notify();
    },
    get closed() {
      return closed;
    },
    get size() {
      return items.length;
    },
    [Symbol.asyncIterator]: () => read(),
  };
}
