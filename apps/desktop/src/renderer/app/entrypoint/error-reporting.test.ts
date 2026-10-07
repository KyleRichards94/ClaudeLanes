import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeBridge, type FakeBridge } from '@/shared/testing';
import { installErrorReporting } from './error-reporting';

let bridge: FakeBridge;
let uninstall: (() => void) | undefined;

beforeEach(() => {
  bridge = installFakeBridge({ 'app:logError': { ok: true, data: null } });
});

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
});

function logErrorCalls() {
  return vi
    .mocked(bridge.invoke)
    .mock.calls.filter(([channel]) => channel === 'app:logError')
    .map(([, report]) => report);
}

function rejection(reason: unknown): Event {
  // jsdom has no PromiseRejectionEvent constructor; the listener only reads `reason`.
  return Object.assign(new Event('unhandledrejection'), { reason });
}

describe('installErrorReporting', () => {
  it('logs uncaught errors and unhandled rejections in the main process', () => {
    uninstall = installErrorReporting(window);

    window.dispatchEvent(new ErrorEvent('error', { error: new RangeError('bad index'), message: 'bad index' }));
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
    window.dispatchEvent(rejection(new Error('fetch failed')));

    expect(logErrorCalls()).toEqual([
      expect.objectContaining({ source: 'window', name: 'RangeError', message: 'bad index' }),
      { source: 'window', message: 'Script error.' },
      expect.objectContaining({ source: 'promise', name: 'Error', message: 'fetch failed' }),
    ]);
  });

  it('stops after 30 reports a minute, then starts again', () => {
    let time = 0;
    uninstall = installErrorReporting(window, () => time);

    for (let n = 0; n < 50; n += 1) window.dispatchEvent(new ErrorEvent('error', { message: `loop ${n}` }));
    expect(logErrorCalls()).toHaveLength(30);

    time = 60_000;
    window.dispatchEvent(new ErrorEvent('error', { message: 'later' }));
    expect(logErrorCalls()).toHaveLength(31);
  });

  it('removes its listeners', () => {
    installErrorReporting(window)();
    window.dispatchEvent(new ErrorEvent('error', { message: 'ignored' }));
    expect(logErrorCalls()).toEqual([]);
  });
});
