import { describe, expect, it } from 'vitest';
import { createKeyedQueue } from './keyed-queue';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('createKeyedQueue', () => {
  it('runs tasks for one key one at a time, in order', async () => {
    const queue = createKeyedQueue();
    const events: string[] = [];
    const gate = deferred();
    const first = queue('repo', async () => {
      events.push('first start');
      await gate.promise;
      events.push('first end');
      return 1;
    });
    const second = queue('repo', async () => {
      events.push('second start');
      return 2;
    });
    await Promise.resolve();
    expect(events).toEqual(['first start']);
    gate.resolve();
    expect(await Promise.all([first, second])).toEqual([1, 2]);
    expect(events).toEqual(['first start', 'first end', 'second start']);
  });

  it('runs different keys side by side', async () => {
    const queue = createKeyedQueue();
    const gate = deferred();
    const blocked = queue('a', () => gate.promise.then(() => 'a'));
    await expect(queue('b', async () => 'b')).resolves.toBe('b');
    gate.resolve();
    await expect(blocked).resolves.toBe('a');
  });

  it('keeps going after a task fails, and passes the failure to its caller only', async () => {
    const queue = createKeyedQueue();
    const failed = queue('repo', async () => {
      throw new Error('boom');
    });
    const next = queue('repo', async () => 'next');
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe('next');
  });
});
