import { app } from 'electron';
import type { AppInfo } from '@agent-lanes/contracts';

/** Name, version and runtime versions: `app:getInfo` and the diagnostics report (AL-214). */
export function readAppInfo(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    versions: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
    },
  };
}
