import { contextBridge, ipcRenderer } from 'electron';
import {
  EVENT_CHANNEL_NAMES,
  INVOKE_CHANNEL_NAMES,
  type AgentLanesBridge,
  type EventChannel,
  type InvokeChannel,
} from '@agent-lanes/contracts/names';

const invokeChannels = new Set<string>(INVOKE_CHANNEL_NAMES);
const eventChannels = new Set<string>(EVENT_CHANNEL_NAMES);

/**
 * The renderer's only door into the main process: named channels from the contracts
 * allow-list, nothing else. Secrets never travel this way (design §8).
 */
const bridge: AgentLanesBridge = {
  invoke(channel: InvokeChannel, payload?: unknown) {
    if (!invokeChannels.has(channel)) {
      return Promise.resolve({ ok: false, code: 'VALIDATION', message: `Unknown channel ${String(channel)}` });
    }
    return ipcRenderer.invoke(channel, payload);
  },
  on(channel: EventChannel, listener: (payload: unknown) => void) {
    if (!eventChannels.has(channel)) {
      throw new Error(`Unknown event channel ${String(channel)}`);
    }
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.removeListener(channel, wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('agentLanes', bridge);
