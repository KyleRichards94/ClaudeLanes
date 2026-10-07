import { describe, expect, it } from 'vitest';
import { createInputQueue } from './input-queue';

describe('session input queue (AL-100)', () => {
  it('hands items to the reader in order, waiting for new ones, and ends on close', async () => {
    const queue = createInputQueue<string>();
    queue.push('a');
    const read: string[] = [];
    const reading = (async () => {
      for await (const item of queue) read.push(item);
    })();
    await new Promise((resolve) => setTimeout(resolve, 5));
    queue.push('b');
    queue.push('c');
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(read).toEqual(['a', 'b', 'c']);
    expect(queue.size).toBe(0);

    queue.close();
    await reading;
    expect(queue.closed).toBe(true);
    expect(queue.push('d')).toBe(false);
    expect(read).toEqual(['a', 'b', 'c']);
  });
});
