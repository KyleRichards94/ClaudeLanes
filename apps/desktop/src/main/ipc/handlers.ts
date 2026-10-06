import { app } from 'electron';
import { ok } from '@agent-lanes/contracts';
import type { InvokeHandlers } from './handle-invoke';

export function createInvokeHandlers(): InvokeHandlers {
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
