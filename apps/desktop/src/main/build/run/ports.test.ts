import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createPortAllocator, findFreePort, isListening } from './ports';

describe('ports', () => {
  it('finds a free port and sees when something listens on it', async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    expect(await isListening(port)).toBe(false);

    const server = createServer((_, response) => response.end('ok'));
    await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
    try {
      expect(await isListening(port)).toBe(true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('never hands the same port to two runs that are both starting', async () => {
    const offered = [5080, 5080, 5081];
    const allocator = createPortAllocator(() => Promise.resolve(offered.shift() ?? 0));
    expect(await allocator.allocate()).toBe(5080);
    expect(await allocator.allocate()).toBe(5081);

    allocator.release(5080);
    const again = createPortAllocator(() => Promise.resolve(5080));
    expect(await again.allocate()).toBe(5080);
    await expect(again.allocate()).rejects.toThrow('Could not find a free port');
  });
});
