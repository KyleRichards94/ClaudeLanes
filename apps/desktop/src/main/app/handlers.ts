import { app } from 'electron';
import { ok, type APP_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';

export function createAppHandlers(): HandlersFor<(typeof APP_INVOKE_CHANNELS)[number]> {
  return {
    'app:getInfo': () =>
      ok({
        name: app.getName(),
        version: app.getVersion(),
        platform: process.platform,
        versions: {
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          node: process.versions.node,
        },
      }),
  };
}
