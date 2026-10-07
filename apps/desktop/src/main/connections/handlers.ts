import { ok, type CONNECTIONS_INVOKE_CHANNELS } from '@agent-lanes/contracts';
import type { HandlersFor } from '../ipc/handle-invoke';
import type { ConnectionsService } from './service';

/**
 * `connections:*` (AL-042). Every reply is a status row or a test outcome; tokens arrive in save and
 * replace requests and go no further than the SecretStore (design §8).
 */
export function createConnectionsHandlers(connections: ConnectionsService): HandlersFor<(typeof CONNECTIONS_INVOKE_CHANNELS)[number]> {
  return {
    'connections:list': async () => ok(await connections.list()),
    'connections:test': (request) => connections.test(request),
    'connections:save': (draft) => connections.save(draft),
    'connections:replace': (request) => connections.replace(request),
    'connections:remove': ({ id }) => connections.remove(id),
    'connections:detectClaude': () => connections.detectClaudeLogin(),
  };
}
