import { createAdoHandlers } from '../ado/handlers';
import { createAgentHandlers } from '../agent/handlers';
import { createAppHandlers } from '../app/handlers';
import { createBuildHandlers } from '../build/handlers';
import { createConnectionsHandlers } from '../connections/handlers';
import { createDesignHandlers } from '../design/handlers';
import { createDiagnosticsHandlers } from '../diagnostics/handlers';
import { createPrHandlers } from '../pull-requests/handlers';
import { createReposHandlers } from '../repos/handlers';
import type { Services } from '../services';
import { createSettingsHandlers } from '../settings/handlers';
import { createSkillsHandlers } from '../skills/handlers';
import { createTicketsHandlers } from '../tickets/handlers';
import { createGitHandlers } from '../worktrees/handlers';
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
    ...createConnectionsHandlers(services.connections),
    ...createDesignHandlers(services),
    ...createAdoHandlers(services.ado),
    ...createReposHandlers(services),
    ...createAgentHandlers(services),
    ...createGitHandlers(services),
    ...createTicketsHandlers(services),
    ...createSkillsHandlers(services),
    ...createPrHandlers(services),
  };
}
