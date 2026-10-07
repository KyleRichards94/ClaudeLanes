import type { McpTransport } from '@agent-lanes/contracts';
import { orgNameFromUrl } from './records';

/**
 * The built-in MCP server each connected Azure DevOps organisation brings (AL-045, design §7): the
 * official Azure DevOps MCP server, started with the organisation's PAT, so an agent can read and
 * comment on its own work item (AL-108).
 */
export interface BuiltInMcpServer {
  /** Shown as the row's name, e.g. `Azure DevOps (CompanionSystems)`. */
  name: string;
  transport: Extract<McpTransport, { type: 'stdio' }>;
  /** The value the server's env var gets for a PAT. */
  tokenFromPat(pat: string): string;
}

/** Gives the built-in server for an organisation URL, or undefined when that organisation gets none. */
export type AdoMcpServerFactory = (orgUrl: string) => BuiltInMcpServer | undefined;

/** npm package of the official server (github.com/microsoft/azure-devops-mcp). */
export const ADO_MCP_PACKAGE = '@azure-devops/mcp';
/** With `--authentication pat` the server reads a base64 Basic credential from this variable. */
export const ADO_MCP_TOKEN_ENV = 'PERSONAL_ACCESS_TOKEN';

/**
 * The Basic credential the server sends: base64 of `<user>:<pat>`. The user part may be anything
 * (the server's docs); an empty one makes it exactly the credential the ADO client sends, a form
 * the token scrubbers and the log redactor already know (D229, D195).
 */
export function adoMcpCredential(pat: string): string {
  return Buffer.from(`:${pat}`, 'utf8').toString('base64');
}

/**
 * `npx -y @azure-devops/mcp <org> --authentication pat` for an Azure DevOps Services organisation
 * (`dev.azure.com/<org>` or `<org>.visualstudio.com`). The server only talks to Azure DevOps Services,
 * so Azure DevOps Server (on-premises) collections get no built-in entry.
 */
export const adoMcpServerFor: AdoMcpServerFactory = (orgUrl) => {
  let url: URL;
  try {
    url = new URL(orgUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:') return undefined;
  const host = url.hostname.toLowerCase();
  let org: string | undefined;
  if (host === 'dev.azure.com') {
    // Normalised URLs name exactly one organisation here.
    if (url.pathname.split('/').filter(Boolean).length === 1) org = orgNameFromUrl(orgUrl);
  } else if (host.endsWith('.visualstudio.com')) {
    // The organisation is the host's first label, whatever collection path follows.
    org = host.slice(0, -'.visualstudio.com'.length);
  }
  if (!org || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(org)) return undefined;

  return {
    name: `Azure DevOps (${org})`,
    transport: { type: 'stdio', command: 'npx', args: ['-y', ADO_MCP_PACKAGE, org, '--authentication', 'pat'], envVar: ADO_MCP_TOKEN_ENV },
    tokenFromPat: adoMcpCredential,
  };
};
