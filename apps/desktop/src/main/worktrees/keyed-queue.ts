/**
 * Runs tasks one at a time per key, in the order they were queued; different keys run side by side.
 * A failed task does not stop the ones queued after it.
 */
export type KeyedQueue = <T>(key: string, task: () => Promise<T>) => Promise<T>;

export function createKeyedQueue(): KeyedQueue {
  /** Settles when the last task queued for the key has finished; never rejects. */
  const tails = new Map<string, Promise<void>>();

  return function run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const result = (tails.get(key) ?? Promise.resolve()).then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  };
}
