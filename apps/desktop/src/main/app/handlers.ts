import { ok } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import { readAppInfo } from './app-info';

/** `app:getInfo`. The app domain's diagnostics channels live in `diagnostics/handlers.ts` (AL-214). */
export function createAppHandlers(): HandlersFor<'app:getInfo'> {
  return {
    'app:getInfo': () => ok(readAppInfo()),
  };
}
