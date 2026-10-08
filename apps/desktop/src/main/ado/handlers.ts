import type { ADO_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { AdoService } from './service';

/**
 * `ado:*` (AL-065). Requests name an organisation by connection id, never a token; replies are the
 * contracts' DTOs. `handleInvoke` validates both against the contracts.
 */
export function createAdoHandlers(ado: AdoService): HandlersFor<(typeof ADO_INVOKE_CHANNELS)[number]> {
  return {
    'ado:listSprints': (request) => ado.listSprints(request),
    'ado:listWorkItems': (request) => ado.listWorkItems(request),
    'ado:searchWorkItems': (request) => ado.searchWorkItems(request),
    'ado:getWorkItem': (request) => ado.getWorkItem(request),
    'ado:getComments': (request) => ado.getComments(request),
    'ado:createPullRequest': (request) => ado.createPullRequest(request),
    'ado:getPullRequest': (request) => ado.getPullRequest(request),
    'ado:listTeams': (request) => ado.listTeams(request),
    'ado:teamBoard': (request) => ado.teamBoard(request),
    'ado:activePrs': (request) => ado.activePrs(request),
    'ado:backlog': (request) => ado.backlog(request),
    'ado:workItemColors': (request) => ado.workItemColors(request),
  };
}
