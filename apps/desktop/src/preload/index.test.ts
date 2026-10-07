import type { AgentLanesBridge, EventChannel } from '@agent-lanes/contracts/names';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// A stand-in for Electron: ipcRenderer is an event emitter that main "sends" on, and the bridge the
// preload exposes is captured instead of being put on a window.
const electron = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events');
  return {
    ipcRenderer: Object.assign(new EventEmitter(), { invoke: vi.fn(async () => ({ ok: true, data: null })) }),
    exposed: new Map<string, unknown>(),
  };
});

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (key: string, api: unknown) => electron.exposed.set(key, api) },
  ipcRenderer: electron.ipcRenderer,
}));

let bridge: AgentLanesBridge;

/** What main's `webContents.mainFrame.send(channel, payload)` looks like to the preload. */
function sendFromMain(channel: string, payload: unknown) {
  electron.ipcRenderer.emit(channel, { sender: electron.ipcRenderer }, payload);
}

beforeAll(async () => {
  await import('./index');
  bridge = electron.exposed.get('agentLanes') as AgentLanesBridge;
});

describe('preload bridge events', () => {
  it('exposes exactly invoke and on', () => {
    expect(Object.keys(bridge).sort()).toEqual(['invoke', 'on']);
  });

  it('delivers the payload of an allow-listed channel, without the Electron event', () => {
    const listener = vi.fn();
    const unsubscribe = bridge.on('toast', listener);
    sendFromMain('toast', { at: 1, tone: 'info', title: 'Saved' });
    expect(listener).toHaveBeenCalledExactlyOnceWith({ at: 1, tone: 'info', title: 'Saved' });
    unsubscribe();
  });

  it('returns an unsubscribe function that stops delivery to that listener only', () => {
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = bridge.on('agent:output', first);
    const unsubscribeSecond = bridge.on('agent:output', second);

    sendFromMain('agent:output', { ticketId: '71273', at: 1 });
    unsubscribeFirst();
    sendFromMain('agent:output', { ticketId: '71273', at: 2 });

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);

    unsubscribeSecond();
    expect(electron.ipcRenderer.listenerCount('agent:output')).toBe(0);
  });

  it('keeps channels apart', () => {
    const listener = vi.fn();
    const unsubscribe = bridge.on('build:log', listener);
    sendFromMain('run:status', { ticketId: '71273', at: 1 });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('throws for a channel that is not in the contracts allow-list', () => {
    expect(() => bridge.on('ado:token' as EventChannel, vi.fn())).toThrow('Unknown event channel ado:token');
    expect(electron.ipcRenderer.listenerCount('ado:token')).toBe(0);
  });
});
