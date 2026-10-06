/// <reference types="vite/client" />
import type { AgentLanesBridge } from '@agent-lanes/contracts/names';

declare global {
  interface Window {
    /** Exposed by the preload (src/preload/index.ts). */
    agentLanes: AgentLanesBridge;
  }

  /** True under `electron-vite dev`; set in electron.vite.config.ts. */
  const __DEV__: boolean;
}
