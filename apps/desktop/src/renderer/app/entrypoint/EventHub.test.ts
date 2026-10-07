import {
  EVENT_CHANNEL_NAMES,
  type AgentOutputEvent,
  type BuildLogEvent,
  type ToastEvent,
} from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { createStore } from 'zustand/vanilla';
import type { EventHandler } from '@/shared/api';
import { fakeOutputEvent, installFakeBridge, type FakeBridge } from '@/shared/testing';
import { HIDDEN_FLUSH_DELAY_MS, createEventHub, startEventHub, stopEventHub, type EventHub } from './EventHub';

let bridge: FakeBridge;
let hubs: EventHub[] = [];

beforeEach(() => {
  // A fake rAF (one frame every 16 ms) and fake timers, driven by the test.
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout'] });
  bridge = installFakeBridge();
});

afterEach(() => {
  for (const hub of hubs) hub.stop();
  hubs = [];
  stopEventHub();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function startHub(): EventHub {
  const hub = createEventHub();
  hub.start();
  hubs.push(hub);
  return hub;
}

/** A Zustand store like the entity stores: one `setState` per batch is one commit. */
function createOutputStore() {
  const store = createStore<{ outputs: AgentOutputEvent[] }>(() => ({ outputs: [] }));
  const commits = vi.fn();
  store.subscribe(commits);
  const onAgentOutput: EventHandler<'agent:output'> = (events) => {
    store.setState((state) => ({ outputs: [...state.outputs, ...events] }));
  };
  const times = () => store.getState().outputs.map((event) => event.at);
  return { store, commits, onAgentOutput, times };
}

describe('EventHub', () => {
  it('subscribes exactly once per channel at start-up and keeps those subscriptions for the app lifetime', () => {
    const hub = startEventHub();
    expect(startEventHub()).toBe(hub);
    hub.start();

    const unregister = hub.register({ 'agent:output': vi.fn(), toast: vi.fn() });
    unregister();
    hub.register({ 'agent:stage': vi.fn(), 'build:log': vi.fn() });
    bridge.emit('agent:stage', { ticketId: '71273', at: 1 });
    vi.advanceTimersToNextFrame();

    expect(bridge.on).toHaveBeenCalledTimes(EVENT_CHANNEL_NAMES.length);
    for (const channel of EVENT_CHANNEL_NAMES) {
      expect(bridge.on).toHaveBeenCalledWith(channel, expect.any(Function));
      expect(bridge.listenerCount(channel)).toBe(1);
    }
  });

  it('commits 1,000 agent:output events that arrive within one frame to the store once, in arrival order', () => {
    const hub = startEventHub();
    const { commits, onAgentOutput, times } = createOutputStore();
    hub.register({ 'agent:output': onAgentOutput });

    for (let at = 0; at < 1000; at += 1) {
      bridge.emit('agent:output', fakeOutputEvent(at % 2 === 0 ? '71273' : '71274', at));
    }
    expect(commits).not.toHaveBeenCalled();

    vi.advanceTimersToNextFrame();

    expect(commits).toHaveBeenCalledOnce();
    expect(times()).toEqual(Array.from({ length: 1000 }, (_, at) => at));

    // The frame cancelled the hidden-window timer, so nothing commits again.
    vi.advanceTimersByTime(HIDDEN_FLUSH_DELAY_MS * 2);
    expect(commits).toHaveBeenCalledOnce();
  });

  it('batches build:log the same way, one batch per channel per frame, and starts a new batch each frame', () => {
    const hub = startHub();
    const output = createOutputStore();
    const onBuildLog = vi.fn<EventHandler<'build:log'>>();
    hub.register({ 'agent:output': output.onAgentOutput, 'build:log': onBuildLog });

    bridge.emit('build:log', { ticketId: '71273', at: 1 });
    bridge.emit('agent:output', fakeOutputEvent('71273', 2));
    bridge.emit('build:log', { ticketId: '71274', at: 3 });
    vi.advanceTimersToNextFrame();

    expect(onBuildLog).toHaveBeenCalledExactlyOnceWith([
      { ticketId: '71273', at: 1 },
      { ticketId: '71274', at: 3 },
    ]);
    expect(output.commits).toHaveBeenCalledOnce();

    bridge.emit('build:log', { ticketId: '71273', at: 4 });
    vi.advanceTimersToNextFrame();

    expect(onBuildLog).toHaveBeenCalledTimes(2);
    expect(onBuildLog).toHaveBeenLastCalledWith([{ ticketId: '71273', at: 4 }]);
    expect(output.commits).toHaveBeenCalledOnce();
  });

  it('hands every other channel to its handlers as each event arrives', () => {
    const hub = startHub();
    const onStage = vi.fn<EventHandler<'agent:stage'>>();
    const onToast = vi.fn<EventHandler<'toast'>>();
    hub.register({ 'agent:stage': onStage, toast: onToast });

    bridge.emit('agent:stage', { ticketId: '71273', at: 1 });
    bridge.emit('agent:stage', { ticketId: '71273', at: 2 });
    bridge.emit('toast', { at: 3, tone: 'error', title: 'Azure DevOps rejected the PAT' });

    expect(onStage).toHaveBeenCalledTimes(2);
    expect(onStage).toHaveBeenNthCalledWith(1, { ticketId: '71273', at: 1 });
    expect(onStage).toHaveBeenNthCalledWith(2, { ticketId: '71273', at: 2 });
    expect(onToast).toHaveBeenCalledExactlyOnceWith({ at: 3, tone: 'error', title: 'Azure DevOps rejected the PAT' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('drops and logs an invalid payload without breaking the stream', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const hub = startHub();
    const { commits, onAgentOutput, times } = createOutputStore();
    const onGate = vi.fn<EventHandler<'agent:gate'>>();
    hub.register({ 'agent:output': onAgentOutput, 'agent:gate': onGate });

    bridge.emit('agent:output', fakeOutputEvent('71273', 1));
    bridge.emit('agent:output', fakeOutputEvent('', 2));
    bridge.emit('agent:output', 'not an event');
    bridge.emit('agent:output', fakeOutputEvent('71273', 4));
    bridge.emit('agent:gate', { at: 5 });
    bridge.emit('agent:gate', { ticketId: '71273', at: 6 });
    vi.advanceTimersToNextFrame();

    expect(times()).toEqual([1, 4]);
    expect(commits).toHaveBeenCalledOnce();
    expect(onGate).toHaveBeenCalledExactlyOnceWith({ ticketId: '71273', at: 6 });
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledWith('Dropped an invalid agent:output event', expect.any(Array));
    expect(warn).toHaveBeenCalledWith('Dropped an invalid agent:gate event', expect.any(Array));

    // A frame with only invalid events commits nothing; the next valid one still arrives.
    bridge.emit('agent:output', fakeOutputEvent('71273', -1));
    vi.advanceTimersToNextFrame();
    expect(commits).toHaveBeenCalledOnce();

    bridge.emit('agent:output', fakeOutputEvent('71273', 7));
    vi.advanceTimersToNextFrame();
    expect(times()).toEqual([1, 4, 7]);
    expect(commits).toHaveBeenCalledTimes(2);
  });

  it('logs a handler that throws, and still serves the other handlers and later events', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hub = startHub();
    const failure = new Error('store bug');
    const failing = vi.fn(() => {
      throw failure;
    });
    const { onAgentOutput, times } = createOutputStore();
    const onStatus = vi.fn<EventHandler<'agent:status'>>();
    hub.register({ 'agent:output': failing, 'agent:status': failing });
    hub.register({ 'agent:output': onAgentOutput, 'agent:status': onStatus });

    bridge.emit('agent:output', fakeOutputEvent('71273', 1));
    const status = { ticketId: '71273', state: 'idle', sessionId: 'session-a', message: null } as const;
    bridge.emit('agent:status', { ...status, at: 2 });
    vi.advanceTimersToNextFrame();
    bridge.emit('agent:output', fakeOutputEvent('71273', 3));
    vi.advanceTimersToNextFrame();

    expect(times()).toEqual([1, 3]);
    expect(onStatus).toHaveBeenCalledExactlyOnceWith({ ...status, at: 2 });
    expect(failing).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenCalledWith('An agent:output event handler failed', failure);
    expect(error).toHaveBeenCalledWith('An agent:status event handler failed', failure);
  });

  it('stops delivering to unregistered handlers and buffers nothing for a channel no store listens to', () => {
    const hub = startHub();
    const onBuildLog = vi.fn<EventHandler<'build:log'>>();
    const twice = vi.fn<EventHandler<'agent:stage'>>();
    const unregister = hub.register({ 'build:log': onBuildLog, 'agent:stage': twice });
    hub.register({ 'agent:stage': twice });

    bridge.emit('build:log', { ticketId: '71273', at: 1 });
    unregister();
    vi.advanceTimersToNextFrame();
    expect(onBuildLog).not.toHaveBeenCalled();

    // Nothing listens to build:log now, so no frame is even scheduled.
    bridge.emit('build:log', { ticketId: '71273', at: 2 });
    expect(vi.getTimerCount()).toBe(0);

    // The same function registered twice is two registrations; removing one leaves the other.
    bridge.emit('agent:stage', { ticketId: '71273', at: 3 });
    expect(twice).toHaveBeenCalledOnce();
  });

  it('hands a batch over after HIDDEN_FLUSH_DELAY_MS when no frame comes, as in a minimised window', () => {
    // Chromium pauses animation frames while the window is hidden.
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const hub = startHub();
    const { commits, onAgentOutput, times } = createOutputStore();
    hub.register({ 'agent:output': onAgentOutput });

    bridge.emit('agent:output', fakeOutputEvent('71273', 1));
    bridge.emit('agent:output', fakeOutputEvent('71273', 2));
    vi.advanceTimersByTime(HIDDEN_FLUSH_DELAY_MS - 1);
    expect(commits).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(commits).toHaveBeenCalledOnce();
    expect(times()).toEqual([1, 2]);
  });

  it('flush() hands buffered batches over at once, and stop() unsubscribes and drops what is buffered', () => {
    const hub = startHub();
    const { commits, onAgentOutput, times } = createOutputStore();
    hub.register({ 'agent:output': onAgentOutput });

    bridge.emit('agent:output', fakeOutputEvent('71273', 1));
    hub.flush();
    expect(times()).toEqual([1]);
    expect(vi.getTimerCount()).toBe(0);

    bridge.emit('agent:output', fakeOutputEvent('71273', 2));
    hub.stop();
    vi.advanceTimersToNextFrame();
    vi.advanceTimersByTime(HIDDEN_FLUSH_DELAY_MS);
    bridge.emit('agent:output', fakeOutputEvent('71273', 3));
    vi.advanceTimersToNextFrame();

    expect(commits).toHaveBeenCalledOnce();
    for (const channel of EVENT_CHANNEL_NAMES) expect(bridge.listenerCount(channel)).toBe(0);
  });

  it('types a batched channel handler by its batch and any other by its event', () => {
    expectTypeOf<Parameters<EventHandler<'agent:output'>>[0]>().toEqualTypeOf<readonly AgentOutputEvent[]>();
    expectTypeOf<Parameters<EventHandler<'build:log'>>[0]>().toEqualTypeOf<readonly BuildLogEvent[]>();
    expectTypeOf<Parameters<EventHandler<'toast'>>[0]>().toEqualTypeOf<ToastEvent>();
  });
});
