import type { McpTransport } from '@agent-lanes/contracts';

/**
 * How an agent session starts one MCP server (AL-045 builds it, AL-108 passes it to the Agent SDK's
 * `mcpServers`). The shapes match the SDK's `McpStdioServerConfig`, `McpHttpServerConfig` and
 * `McpSSEServerConfig` (a test checks they stay assignable). These hold the token: main process only,
 * never sent over IPC or logged.
 */
export interface McpStdioSessionConfig {
  type: 'stdio';
  command: string;
  args: string[];
  /** The token under the server's env var, when it takes one; the SDK adds the rest of the environment. */
  env: Record<string, string>;
}

export interface McpHttpSessionConfig {
  type: 'http';
  url: string;
  headers: Record<string, string>;
}

export interface McpSseSessionConfig {
  type: 'sse';
  url: string;
  headers: Record<string, string>;
}

export type McpSessionConfig = McpStdioSessionConfig | McpHttpSessionConfig | McpSseSessionConfig;

/**
 * Commands that are `.cmd` shims on Windows. Node's `spawn` can't start those without a shell, so a
 * session starts them through `cmd /c` (Claude Code's documented setup for `npx` servers on native
 * Windows). The connection test doesn't need this: it spawns with cross-spawn, which resolves shims.
 */
const WINDOWS_SHIMS = new Set(['npx', 'npm', 'pnpm', 'pnpx', 'yarn', 'bunx']);

function isWindowsShim(command: string): boolean {
  const name = command.trim().toLowerCase();
  return WINDOWS_SHIMS.has(name) || name.endsWith('.cmd') || name.endsWith('.bat');
}

/**
 * The header value for a token. A token can't contain spaces (the draft schema), so for
 * `Authorization` the scheme is added here: `Bearer <token>`. Any other header gets the token as is.
 */
export function mcpHeaderValue(header: string, token: string): string {
  return header.toLowerCase() === 'authorization' ? `Bearer ${token}` : token;
}

/** The headers a remote server gets: its token under the header the user named, if it takes one. */
export function mcpHeaders(transport: Extract<McpTransport, { type: 'http' | 'sse' }>, token: string | undefined): Record<string, string> {
  return transport.header && token ? { [transport.header]: mcpHeaderValue(transport.header, token) } : {};
}

/** The env vars a stdio server gets from its connection: its token, if it takes one. */
export function mcpEnv(transport: Extract<McpTransport, { type: 'stdio' }>, token: string | undefined): Record<string, string> {
  return transport.envVar && token ? { [transport.envVar]: token } : {};
}

/**
 * A saved server's transport and token as a session config: the token goes into the env var
 * (stdio) or header (HTTP/SSE) the user chose, at launch (design §7, §8).
 */
export function toMcpSessionConfig(
  transport: McpTransport,
  token: string | undefined,
  platform: NodeJS.Platform = process.platform,
): McpSessionConfig {
  if (transport.type === 'stdio') {
    const wrap = platform === 'win32' && isWindowsShim(transport.command);
    return {
      type: 'stdio',
      command: wrap ? 'cmd' : transport.command,
      args: wrap ? ['/c', transport.command, ...transport.args] : [...transport.args],
      env: mcpEnv(transport, token),
    };
  }
  const headers = mcpHeaders(transport, token);
  return transport.type === 'http' ? { type: 'http', url: transport.url, headers } : { type: 'sse', url: transport.url, headers };
}

/**
 * Names a session knows its MCP servers by (the `<name>` in `mcp__<name>__<tool>`). `agent_lanes` is
 * the stage server (AL-103); `azure-devops` the built-in ADO server for the work item's organisation.
 */
export const RESERVED_SESSION_SERVER_NAMES = ['agent_lanes', 'azure-devops'] as const;
export const ADO_SESSION_SERVER_NAME = 'azure-devops';

/** `github`, or `github-2` when that name is taken. */
export function uniqueSessionName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
