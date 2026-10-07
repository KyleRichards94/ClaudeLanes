import type { EventPayload } from '@agent-lanes/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installFakeBridge } from '@/shared/testing';
import { subscribe } from './events';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('subscribe', () => {
  it('delivers a fake bridge event to the subscriber, typed by its contract', () => {
    const bridge = installFakeBridge();
    const received: EventPayload<'agent:stage'>[] = [];
    subscribe('agent:stage', (payload) => received.push(payload));

    const stage = { ticketId: '71273', at: 1_760_000_000_000, change: 'stage', stage: 'implementing', from: 'planning', activity: 'Plan approved', progress: 0 } as const;
    bridge.emit('agent:stage', stage);

    expect(received).toEqual([stage]);
  });

  it('only hears its own channel', () => {
    const bridge = installFakeBridge();
    const listener = vi.fn();
    subscribe('build:log', listener);

    bridge.emit('run:status', { ticketId: '71273', at: 1 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('logs and drops a payload that breaks the contract, and keeps delivering after it', () => {
    const bridge = installFakeBridge();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const listener = vi.fn();
    subscribe('toast', listener);

    bridge.emit('toast', { at: 1, tone: 'loud', title: 'Not a tone' });
    bridge.emit('toast', { at: 2, tone: 'error', title: 'MCP bridge lost the session' });

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toBe('Dropped an invalid toast event');
    expect(listener).toHaveBeenCalledExactlyOnceWith({ at: 2, tone: 'error', title: 'MCP bridge lost the session' });
  });

  it('passes on only the fields the contract declares', () => {
    const bridge = installFakeBridge();
    const listener = vi.fn();
    subscribe('agent:output', listener);

    const event = { ticketId: '71273', at: 3, seq: 1, item: { kind: 'system', text: 'Plan approved', parentToolUseId: null } } as const;
    bridge.emit('agent:output', { ...event, extra: 'not in the contract', item: { ...event.item, secret: 'not in the contract' } });

    expect(listener).toHaveBeenCalledExactlyOnceWith(event);
  });

  it('returns an unsubscribe function that stops delivery', () => {
    const bridge = installFakeBridge();
    const listener = vi.fn();
    const unsubscribe = subscribe('connections:changed', listener);

    bridge.emit('connections:changed', { at: 1 });
    unsubscribe();
    bridge.emit('connections:changed', { at: 2 });

    expect(listener).toHaveBeenCalledOnce();
    expect(bridge.listenerCount('connections:changed')).toBe(0);
  });

  it('refuses a channel the contracts do not declare, like the preload', () => {
    installFakeBridge();
    expect(() => subscribe('ado:token' as 'toast', vi.fn())).toThrow('Unknown event channel ado:token');
  });
});
