import { createAppHandlers } from '../app/handlers';
import { createBuildHandlers } from '../build/handlers';
import { createDiagnosticsHandlers } from '../diagnostics/handlers';
import type { Services } from '../services';
import { createSettingsHandlers } from '../settings/handlers';
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
    ...createSettingsHandlers(services.settings),
    ...createBuildHandlers(services),
    ...createDiagnosticsHandlers(services),
  };
}
