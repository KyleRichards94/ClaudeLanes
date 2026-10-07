import { createConnection, createServer } from 'node:net';

/** A port nothing on this machine listens on right now, picked by the OS. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ port: 0, host: '127.0.0.1', exclusive: true }, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('The OS gave no port'))));
    });
  });
}

/** Whether something accepts TCP connections on `port` at 127.0.0.1 (or ::1). */
export function isListening(port: number, timeoutMs = 500): Promise<boolean> {
  const attempt = (host: string) =>
    new Promise<boolean>((resolve) => {
      const socket = createConnection({ port, host });
      const done = (open: boolean) => {
        socket.destroy();
        resolve(open);
      };
      socket.setTimeout(timeoutMs, () => done(false));
      socket.once('connect', () => done(true));
      socket.once('error', () => done(false));
    });
  return attempt('127.0.0.1').then((open) => open || attempt('::1'));
}

/**
 * Hands out free ports and remembers the ones given to runs still starting, so two tickets
 * started at the same moment never get the same port (AL-133).
 */
export interface PortAllocator {
  allocate(): Promise<number>;
  release(port: number): void;
}

export function createPortAllocator(find: () => Promise<number> = findFreePort): PortAllocator {
  const taken = new Set<number>();
  return {
    async allocate() {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const port = await find();
        if (!taken.has(port)) {
          taken.add(port);
          return port;
        }
      }
      throw new Error('Could not find a free port');
    },
    release(port) {
      taken.delete(port);
    },
  };
}
