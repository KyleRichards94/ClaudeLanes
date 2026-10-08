import type { TicketAdoRef, TicketRecord } from '@agent-lanes/contracts';
import { ADO_SESSION_SERVER_NAME, type ConnectionsService } from '../../connections';
import type { Logger } from '../../logging';
import type { SessionExtras } from '../session-manager';

/**
 * The MCP servers each ticket session gets (AL-108, design §7 MCP servers): the official Azure DevOps
 * server for the work item's organisation, with that organisation's PAT in its env (AL-045), and every
 * MCP server the user added in Connections. The `agent_lanes` stage server comes from AL-103's extras.
 */

/**
 * Tools of the Azure DevOps server the agent may use without asking: reading its work item and its
 * comments, and adding a comment. Anything else the server offers goes through the permission
 * policy (AL-109).
 */
export const ADO_MCP_ALLOWED_TOOLS = ['wit_get_work_item', 'wit_list_work_item_comments', 'wit_add_work_item_comment'].map(
  (tool) => `mcp__${ADO_SESSION_SERVER_NAME}__${tool}`,
);

/** `https://dev.azure.com/Contoso/` and `https://dev.azure.com/contoso` name the same organisation. */
function sameOrg(a: string, b: string): boolean {
  const clean = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();
  return clean(a) === clean(b);
}

/** Said in a new session's first turn when the work item's organisation brought its server. */
export function workItemMcpHint(ado: TicketAdoRef): string {
  return [
    `Your work item is #${ado.workItemId} in the Azure DevOps project "${ado.project}" (${ado.orgUrl}).`,
    `Read it, its comments and add comments through the \`${ADO_SESSION_SERVER_NAME}\` MCP server; it is signed in as the user.`,
  ].join(' ');
}

export interface McpSessionExtrasOptions {
  connections: Pick<ConnectionsService, 'list' | 'sessionMcpServers'>;
  log?: Pick<Logger, 'warn'>;
}

/** Session extras with the MCP servers for a ticket; see `combineSessionExtras`. */
export function mcpSessionExtras(options: McpSessionExtrasOptions): (record: TicketRecord) => Promise<SessionExtras> {
  return async (record) => {
    const ado = record.ado;
    const connection = ado ? (await options.connections.list()).find((row) => row.kind === 'ado' && sameOrg(row.orgUrl, ado.orgUrl)) : undefined;
    const { servers, unavailable } = await options.connections.sessionMcpServers(connection ? { adoConnectionId: connection.id } : {});
    for (const server of unavailable) {
      options.log?.warn(`Ticket ${record.id} starts without the MCP server ${server.name}: ${server.reason}`);
    }
    const hasAdo = ado !== null && ADO_SESSION_SERVER_NAME in servers;
    return {
      mcpServers: servers,
      allowedTools: hasAdo ? ADO_MCP_ALLOWED_TOOLS : [],
      firstTurnAppendix: hasAdo ? [workItemMcpHint(ado)] : [],
    };
  };
}
