import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentTicketEventHandlers, createAgentTicketStore, selectLaneTicketIds } from '@/entities/agent-ticket';
import { fakeStageEvent, fakeTicketRecord, installFakeBridge, type FakeBridge } from '@/shared/testing';
import { createEventHub, type EventHub } from './EventHub';

/**
 * AL-103: a `set_stage` call reaches the board as `agent:stage`, which the event hub hands to the
 * ticket store as soon as it arrives (it is not batched), so the card is in its new lane before the
 * next animation frame paints.
 */

let bridge: FakeBridge;
let hub: EventHub;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  bridge = installFakeBridge();
  hub = createEventHub();
  hub.start();
});

afterEach(() => {
  hub.stop();
  vi.useRealTimers();
});

describe('agent:stage through the event hub', () => {
  it('moves the card within one frame of the event', () => {
    const store = createAgentTicketStore();
    store.load([fakeTicketRecord({ id: '71273', stage: 'planning' })]);
    hub.register(createAgentTicketEventHandlers(store));
    const commits = vi.fn();
    store.subscribe(commits);

    bridge.emit('agent:stage', fakeStageEvent('71273', 5_000, { stage: 'implementing', from: 'planning' }));

    // No frame has run yet: the store already holds the move, ready for the next paint.
    expect(selectLaneTicketIds(store.getState(), 'implementing')).toEqual(['71273']);
    expect(selectLaneTicketIds(store.getState(), 'planning')).toEqual([]);
    expect(commits).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops a stage event whose payload does not match the contract', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = createAgentTicketStore();
    store.load([fakeTicketRecord({ id: '71273', stage: 'planning' })]);
    hub.register(createAgentTicketEventHandlers(store));

    bridge.emit('agent:stage', { ...fakeStageEvent('71273', 5_000), stage: 'shipping' });
    expect(selectLaneTicketIds(store.getState(), 'planning')).toEqual(['71273']);
    expect(warn).toHaveBeenCalledWith('Dropped an invalid agent:stage event', expect.any(Array));
    warn.mockRestore();
  });
});
