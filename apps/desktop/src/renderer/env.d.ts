/// <reference types="vite/client" />
import type { AgentLanesBridge } from '@agent-lanes/contracts/names';

declare global {
  interface Window {
    /** Exposed by the preload (src/preload/index.ts). */
    agentLanes: AgentLanesBridge;
  }

  /** True under `electron-vite dev`; set in electron.vite.config.ts. */
  const __DEV__: boolean;

  /** True in builds that have the component gallery (AL-032): `electron-vite dev` and `--mode gallery`. */
  const __GALLERY__: boolean;
}
