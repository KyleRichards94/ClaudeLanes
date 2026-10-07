import { pathToFileURL } from 'node:url';
import type { EventChannel } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createEmitter, type EmitterOptions, type EventFrame } from './emit';
import type { RendererLocation } from './router';

const rendererFile = process.platform === 'win32' ? 'C:\\Apps\\Agent Lanes\\out\\renderer\\index.html' : '/opt/agent-lanes/out/renderer/index.html';
const packaged: RendererLocation = { url: undefined, file: rendererFile };
const devServer: RendererLocation = { url: 'http://localhost:5173', file: rendererFile };

function fakeFrame(url: string, destroyed = false) {
  const send = vi.fn<(channel: string, ...args: unknown[]) => void>();
  const frame: EventFrame = { url, isDestroyed: () => destroyed, send };
  return { frame, send };
}

function setup(overrides: Partial<EmitterOptions> = {}) {
  const { frame, send } = fakeFrame(pathToFileURL(rendererFile).href);
  const log = vi.fn();
  const emit = createEmitter({ frame: () => frame, renderer: packaged, strict: true, log, ...overrides });
  return { emit, send, log };
}

/** Lets a test pass a payload that breaks its contract, as a buggy caller would. */
function invalid(payload: unknown): never {
  return payload as never;
}

describe('emit', () => {
  it('sends a valid payload to the trusted renderer frame', () => {
    const { emit, send } = setup();
    const status = { ticketId: '71273', state: 'running', sessionId: 'session-a', message: null } as const;
    emit('agent:status', { ...status, at: 1_760_000_000_000 });
    expect(send).toHaveBeenCalledExactlyOnceWith('agent:status', { ...status, at: 1_760_000_000_000 });
  });

  it('trusts the dev server origin in development', () => {
    const { frame, send } = fakeFrame('http://localhost:5173/');
    const emit = createEmitter({ frame: () => frame, renderer: devServer, strict: true });
    emit('toast', { tone: 'info', title: 'Saved', at: 1 });
    expect(send).toHaveBeenCalledExactlyOnceWith('toast', { tone: 'info', title: 'Saved', at: 1 });
  });

  it('stamps at with the current time when the caller leaves it out', () => {
    const { emit, send } = setup();
    const before = Date.now();
    emit('connections:changed', {});
    const sent = send.mock.calls[0]?.[1] as { at: number };
    expect(sent.at).toBeGreaterThanOrEqual(before);
    expect(sent.at).toBeLessThanOrEqual(Date.now());
  });

  it('sends only the fields the contract declares, so secrets passed by mistake never cross IPC', () => {
    const { emit, send } = setup();
    emit('agent:stage', invalid({ ticketId: '71273', at: 5, pat: 'not-a-real-token' }));
    expect(send).toHaveBeenCalledExactlyOnceWith('agent:stage', { ticketId: '71273', at: 5 });
  });

  describe('with an invalid payload', () => {
    it('throws in development and sends nothing', () => {
      const { emit, send, log } = setup({ strict: true });
      expect(() => emit('agent:output', invalid({ at: 5 }))).toThrow(/Invalid payload for agent:output[\s\S]*ticketId/);
      expect(send).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });

    it('logs and drops it in production', () => {
      const { emit, send, log } = setup({ strict: false });
      expect(() => emit('toast', invalid({ tone: 'loud', title: 'x' }))).not.toThrow();
      expect(send).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledOnce();
      expect(log.mock.calls[0]?.[0]).toMatch(/Dropped an event\. Invalid payload for toast/);
    });

    it('treats an unknown channel the same way', () => {
      const strict = setup({ strict: true });
      expect(() => strict.emit('nope' as EventChannel, invalid({}))).toThrow('Unknown event channel nope');

      const lenient = setup({ strict: false });
      lenient.emit('nope' as EventChannel, invalid({}));
      expect(lenient.send).not.toHaveBeenCalled();
      expect(lenient.log).toHaveBeenCalledOnce();
    });

    it('does not echo the rejected values into the log', () => {
      const { emit, log } = setup({ strict: false });
      emit('agent:gate', invalid({ ticketId: 42, at: 5, secret: 'not-a-real-token' }));
      expect(JSON.stringify(log.mock.calls)).not.toContain('not-a-real-token');
    });
  });

  describe('delivery only to the trusted renderer frame', () => {
    it('refuses a frame showing another origin, such as the Claude Design view', () => {
      const { frame, send } = fakeFrame('https://claude.ai/design');
      const log = vi.fn();
      const emit = createEmitter({ frame: () => frame, renderer: devServer, strict: true, log });
      emit('design:spec', { ticketId: '71273', at: 5 });
      expect(send).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith('Refused design:spec for an untrusted frame');
    });

    it('refuses a different local file when packaged', () => {
      const { frame, send } = fakeFrame(pathToFileURL(rendererFile.replace('index.html', 'evil.html')).href);
      const emit = createEmitter({ frame: () => frame, renderer: packaged, strict: true, log: vi.fn() });
      emit('build:log', { ticketId: '71273', at: 5 });
      expect(send).not.toHaveBeenCalled();
    });

    it('drops events quietly while there is no window, the frame is gone, or the page is still loading', () => {
      const log = vi.fn();
      const gone = fakeFrame(pathToFileURL(rendererFile).href, true);
      const loading = fakeFrame('');

      for (const frame of [undefined, gone.frame, loading.frame]) {
        const emit = createEmitter({ frame: () => frame, renderer: packaged, strict: true, log });
        emit('run:status', { ticketId: '71273', at: 5 });
      }

      expect(gone.send).not.toHaveBeenCalled();
      expect(loading.send).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });

    it('reads the frame on every emit, so a recreated window keeps receiving', () => {
      const mainWindow: { frame?: EventFrame } = {};
      const emit = createEmitter({ frame: () => mainWindow.frame, renderer: packaged, strict: true });
      emit('agent:subagent', { ticketId: '71273', at: 1 });

      const { frame, send } = fakeFrame(pathToFileURL(rendererFile).href);
      mainWindow.frame = frame;
      emit('agent:subagent', { ticketId: '71273', at: 2 });
      expect(send).toHaveBeenCalledExactlyOnceWith('agent:subagent', { ticketId: '71273', at: 2 });
    });
  });
});
