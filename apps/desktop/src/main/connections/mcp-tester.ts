import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { MCP_TOOLS_LIMIT, type McpTransport } from '@agent-lanes/contracts';
import { mcpEnv, mcpHeaders } from './mcp-session';
import type { ConnectionTestOutcome, ConnectionTester } from './testers';

/**
 * The MCP server test (AL-045, design §8): start the server the way a session would (spawn the
 * command, or connect to the URL), do the MCP handshake, and list its tools. When the server doesn't
 * start, its error output is what the row shows, so stderr is kept (the last part of it).
 */
export interface McpConnectionTesterOptions {
  /** Longest wait for each step (handshake, each page of tools). Kept under the service's 60 s limit. */
  timeoutMs?: number;
  /** Working folder of a stdio server under test. Defaults to the user's home folder. */
  cwd?: string;
  /** For HTTP and SSE servers; defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Ends a stdio server and anything it started; defaults to `taskkill /T /F` on Windows. */
  killTree?: (pid: number) => Promise<void>;
  platform?: NodeJS.Platform;
}

export const MCP_TEST_TIMEOUT_MS = 55_000;
/** How much of a server's error output a failed test reports (its end, where the error usually is). */
export const MCP_ERROR_OUTPUT_LIMIT = 2_000;
const TOOL_PAGES_LIMIT = 20;
const IDENTITY_LIMIT = 200;

/**
 * Inherited by a stdio server on top of the MCP SDK's safe defaults (PATH, APPDATA, USERPROFILE, …):
 * what `npx`/`uvx` need to resolve shims and get through a proxy. Nothing else of the app's
 * environment reaches a server under test, so no other token can leak into it.
 */
const EXTRA_INHERITED_ENV = [
  'PATHEXT',
  'COMSPEC',
  'WINDIR',
  'PROGRAMDATA',
  'PROGRAMFILES(X86)',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  'NODE_EXTRA_CA_CERTS',
  'LANG',
  'TMPDIR',
] as const;

function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of EXTRA_INHERITED_ENV) {
    const value = process.env[name];
    if (value !== undefined && !value.startsWith('()')) env[name] = value;
  }
  return env;
}

/** Keeps the end of a stream's text, up to `limit` characters. */
function createOutputTail(limit: number) {
  let text = '';
  return {
    append(chunk: unknown) {
      text = (text + String(chunk)).slice(-limit * 2);
    },
    text(): string {
      const trimmed = text.replace(/\r\n/g, '\n').trim();
      return trimmed.length > limit ? `…${trimmed.slice(-limit)}` : trimmed;
    },
  };
}

function taskkillTree(pid: number): Promise<void> {
  return new Promise((resolve) => {
    execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
  });
}

function errorCode(cause: unknown): string | undefined {
  if (typeof cause !== 'object' || cause === null) return undefined;
  const code = (cause as { code?: unknown }).code;
  if (typeof code === 'string') return code;
  return errorCode((cause as { cause?: unknown }).cause);
}

function httpStatus(cause: unknown): number | undefined {
  const code = typeof cause === 'object' && cause !== null ? (cause as { code?: unknown }).code : undefined;
  return typeof code === 'number' && code >= 400 && code < 600 ? code : undefined;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** `fetch failed` says little; its `cause` chain has the reason (`ECONNREFUSED`, `bad port`, a TLS error). */
function withReason(cause: unknown): string {
  const text = describe(cause);
  const code = errorCode(cause);
  if (code) return text.includes(code) ? text : `${text} (${code})`;
  let inner: unknown = cause;
  for (let depth = 0; depth < 5 && typeof inner === 'object' && inner !== null && 'cause' in inner; depth += 1) inner = inner.cause;
  return inner !== cause && inner instanceof Error && !text.includes(inner.message) ? `${text} (${inner.message})` : text;
}

/** cmd.exe's answer when cross-spawn runs a command it can't find through it (Windows). */
const NOT_RECOGNIZED = /is not recognized as an internal or external command/i;

/** MCP SDK error codes (`ErrorCode` in its types). */
const CONNECTION_CLOSED = -32000;
const REQUEST_TIMEOUT = -32001;

/** One line saying what went wrong, for the row; the server's error output follows it. */
function headline(transport: McpTransport, cause: unknown, timeoutMs: number, aborted: boolean, output: string): string {
  const code = typeof cause === 'object' && cause !== null ? (cause as { code?: unknown }).code : undefined;
  const seconds = Math.round(timeoutMs / 1000);
  if (aborted || code === REQUEST_TIMEOUT || (cause instanceof Error && cause.name === 'AbortError')) {
    return `The MCP server did not answer within ${seconds} seconds.`;
  }
  if (transport.type === 'stdio') {
    const failure = errorCode(cause);
    if (failure === 'ENOENT' || NOT_RECOGNIZED.test(output)) {
      return `Could not start "${transport.command}": the command was not found. Check it is installed and on PATH.`;
    }
    if (failure === 'EACCES' || failure === 'EPERM') return `Could not start "${transport.command}": permission denied.`;
    if (code === CONNECTION_CLOSED) return `"${transport.command}" stopped before it answered as an MCP server.`;
    return `"${transport.command}" did not start as an MCP server: ${describe(cause)}`;
  }
  const status = httpStatus(cause);
  if (status === 401 || status === 403) return `${transport.url} refused the request (HTTP ${status}). Check the token and the header it goes in.`;
  if (status !== undefined) return `${transport.url} answered HTTP ${status}: ${describe(cause)}`;
  return `Could not connect to ${transport.url}: ${withReason(cause)}`;
}

/**
 * Tests an MCP server draft by starting it and listing its tools. Never throws; a server that doesn't
 * start reports why, with the end of its error output. The service scrubs the token from the result.
 */
export function createMcpConnectionTester(options: McpConnectionTesterOptions = {}): ConnectionTester<'mcp'> {
  const timeoutMs = options.timeoutMs ?? MCP_TEST_TIMEOUT_MS;
  const platform = options.platform ?? process.platform;
  const killTree = options.killTree ?? (platform === 'win32' ? taskkillTree : undefined);

  return async (draft, signal): Promise<ConnectionTestOutcome> => {
    const { transport: spec, token } = draft;
    const output = createOutputTail(MCP_ERROR_OUTPUT_LIMIT);
    let protocolError: Error | undefined;

    let transport: Transport;
    let stdio: StdioClientTransport | undefined;
    if (spec.type === 'stdio') {
      stdio = new StdioClientTransport({
        command: spec.command,
        args: spec.args,
        env: { ...inheritedEnv(), ...mcpEnv(spec, token) },
        cwd: options.cwd ?? homedir(),
        stderr: 'pipe',
      });
      stdio.stderr?.on('data', (chunk: unknown) => output.append(chunk));
      transport = stdio;
    } else {
      const init = {
        requestInit: { headers: mcpHeaders(spec, token) },
        ...(options.fetch ? { fetch: options.fetch } : {}),
      };
      transport = spec.type === 'http' ? new StreamableHTTPClientTransport(new URL(spec.url), init) : new SSEClientTransport(new URL(spec.url), init);
    }

    const deadline = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    const request = { signal: deadline, timeout: timeoutMs };
    const client = new Client({ name: 'agent-lanes-connection-test', version: '1.0.0' }, { capabilities: {} });
    client.onerror = (error) => {
      protocolError = error;
    };

    try {
      await client.connect(transport, request);
      const tools: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < TOOL_PAGES_LIMIT && tools.length < MCP_TOOLS_LIMIT; page += 1) {
        const listed = await client.listTools(cursor ? { cursor } : undefined, request);
        for (const tool of listed.tools) tools.push(tool.name.slice(0, 128));
        cursor = listed.nextCursor;
        if (!cursor) break;
      }
      const server = client.getServerVersion();
      const identity = server ? `${server.title || server.name} ${server.version}`.trim().slice(0, IDENTITY_LIMIT) : null;
      return { status: 'ok', identity: identity || null, message: null, tools: tools.filter(Boolean).slice(0, MCP_TOOLS_LIMIT) };
    } catch (cause) {
      // The process has gone; let the last of its stderr arrive.
      await new Promise((resolve) => setTimeout(resolve, 50));
      const errors = output.text();
      const lines = [headline(spec, cause, timeoutMs, deadline.aborted, errors)];
      if (errors) lines.push(errors);
      else if (protocolError && protocolError !== cause) lines.push(`Its output isn't MCP: ${describe(protocolError)}`);
      return { status: 'error', identity: null, message: lines.join('\n') };
    } finally {
      await shutDown(client, stdio?.pid ?? null, killTree);
    }
  };
}

/** How long a stdio server gets to exit once its stdin closes before its process tree is ended. */
const GRACE_MS = 500;

/**
 * Closing stdin is how an MCP client asks a stdio server to stop. The SDK then sends SIGTERM, which
 * on Windows ends only the process it started: for a `.cmd` shim (npx) that is cmd.exe, and the
 * server under it would be left running. So a server still there after a short grace is ended with
 * its whole tree first.
 */
async function shutDown(client: Client, pid: number | null, killTree: ((pid: number) => Promise<void>) | undefined): Promise<void> {
  const closing = client.close().catch(() => undefined);
  if (pid !== null && killTree) {
    const exited = await Promise.race([closing.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), GRACE_MS))]);
    if (!exited) await killTree(pid).catch(() => undefined);
  }
  await closing;
}
