import { createAppHandlers } from '../app/handlers';
import type { Services } from '../services';
import type { InvokeHandlers } from './handle-invoke';

/**
 * Every IPC handler, one factory per domain. A domain adds its line here once its channels exist
 * in packages/contracts; `InvokeHandlers` fails the build until every channel has a handler.
 * Keep one line per domain so parallel tickets don't collide.
 */
export function createInvokeHandlers(services: Services): InvokeHandlers {
  void services;
  return {
    ...createAppHandlers(),
  };
}
