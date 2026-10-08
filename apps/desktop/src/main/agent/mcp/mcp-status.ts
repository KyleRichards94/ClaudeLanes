import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  MCP_ERROR_LIMIT,
  MCP_SERVER_STATES,
  isFailingMcpState,
  type AgentSessionState,
  type McpServerState,
  type McpSessionServer,
  type McpStatusSummary,
} from '@agent-lanes/contracts';
import type { Emit } from '../../ipc/emit';
import type { Logger } from '../../logging';
import type { SessionManager } from '../session-manager';

/**
 * The header pill's MCP status (AL-108, artboard 1 "MCP online"): what every running session's
 * `mcpServerStatus()` says, merged per server name. A server that fails gets one `reconnectMcpServer`
 * per failure; if it is still failing the pill turns amber with its name.
 *
 * The status is read when a session starts (its `system/init` message lists its servers), shortly
 * after, and then every `intervalMs` while sessions run. These are control requests to the local
 * `claude` process; they use no tokens.
 */
export interface McpStatusMonitor {
  summary(): McpStatusSummary;
  /** Reads the servers of one ticket's session now, or of every live session. */
  refresh(ticketId?: string): Promise<void>;
  dispose(): void;
}

export interface McpStatusMonitorOptions {
  sessions: Pick<SessionManager, 'subscribe' | 'list' | 'mcpServerStatus' | 'reconnectMcpServer'>;
  emit: Emit;
  log?: Pick<Logger, 'info' | 'warn'>;
  /** How often running sessions are asked; 0 turns the timer off (tests call `refresh`). */
  intervalMs?: number;
  /** Reconnects tried per server while it keeps failing; it gets one again after it connects. */
  maxReconnects?: number;
}

export const MCP_STATUS_INTERVAL_MS = 15_000;

const LIVE: ReadonlySet<AgentSessionState> = new Set(['starting', 'running', 'idle', 'paused']);

/** Worst first: what the pill shows when sessions disagree about a server. */
const SEVERITY: Record<McpServerState, number> = { failed: 4, 'needs-auth': 3, pending: 2, connected: 1, disabled: 0 };

interface ServerReading {
  name: string;
  state: McpServerState;
  error: string | null;
}

function toState(status: string): McpServerState {
  return (MCP_SERVER_STATES as readonly string[]).includes(status) ? (status as McpServerState) : 'pending';
}

function reading(status: { name: string; status: string; error?: string | undefined }): ServerReading {
  const error = status.error?.trim();
  return {
    name: status.name,
    state: toState(status.status),
    error: error ? (error.length > MCP_ERROR_LIMIT ? `${error.slice(0, MCP_ERROR_LIMIT - 1)}…` : error) : null,
  };
}

/** The servers of every running session, merged per name: the worst state wins, with its error. */
export function summariseMcpStatus(byTicket: ReadonlyMap<string, readonly ServerReading[]>): McpStatusSummary {
  const merged = new Map<string, McpSessionServer>();
  for (const [ticketId, servers] of byTicket) {
    for (const server of servers) {
      const known = merged.get(server.name);
      if (!known) {
        merged.set(server.name, { name: server.name, state: server.state, error: server.error, ticketIds: [ticketId] });
        continue;
      }
      if (!known.ticketIds.includes(ticketId)) known.ticketIds.push(ticketId);
      if (SEVERITY[server.state] > SEVERITY[known.state]) {
        known.state = server.state;
        known.error = server.error;
      }
    }
  }
  const servers = [...merged.values()]
    .map((server) => ({ ...server, ticketIds: [...server.ticketIds].sort() }))
    .sort((a, b) => Number(isFailingMcpState(b.state)) - Number(isFailingMcpState(a.state)) || a.name.localeCompare(b.name));
  const state = byTicket.size === 0 ? 'none' : servers.some((server) => isFailingMcpState(server.state)) ? 'failing' : 'online';
  return { state, servers };
}

export function createMcpStatusMonitor(options: McpStatusMonitorOptions): McpStatusMonitor {
  const { sessions, emit, log } = options;
  const maxReconnects = options.maxReconnects ?? 1;
  const byTicket = new Map<string, ServerReading[]>();
  const reconnects = new Map<string, number>();
  const inFlight = new Map<string, Promise<void>>();
  let sent = JSON.stringify(summariseMcpStatus(byTicket));
  let disposed = false;

  function publish(): void {
    if (disposed) return;
    const summary = summariseMcpStatus(byTicket);
    const text = JSON.stringify(summary);
    if (text === sent) return;
    sent = text;
    emit('agent:mcpStatus', summary);
  }

  function forget(ticketId: string): void {
    byTicket.delete(ticketId);
    for (const key of [...reconnects.keys()]) if (key.startsWith(`${ticketId}\0`)) reconnects.delete(key);
  }

  async function read(ticketId: string): Promise<ServerReading[] | null> {
    const status = await sessions.mcpServerStatus(ticketId);
    return status.ok ? status.data.map(reading) : null;
  }

  /** Reconnects each failing server that has tries left; true when it asked for any. */
  async function reconnectFailing(ticketId: string, servers: readonly ServerReading[]): Promise<boolean> {
    let asked = false;
    for (const server of servers) {
      const key = `${ticketId}\0${server.name}`;
      if (server.state === 'connected') reconnects.delete(key);
      if (server.state !== 'failed') continue;
      const tried = reconnects.get(key) ?? 0;
      if (tried >= maxReconnects) continue;
      reconnects.set(key, tried + 1);
      log?.info(`Reconnecting the MCP server ${server.name} of ticket ${ticketId}${server.error ? ` (${server.error})` : ''}`);
      const done = await sessions.reconnectMcpServer(ticketId, server.name);
      if (!done.ok) log?.warn(done.message);
      asked = true;
    }
    return asked;
  }

  async function refreshTicket(ticketId: string): Promise<void> {
    let servers = await read(ticketId);
    if (servers && (await reconnectFailing(ticketId, servers))) servers = await read(ticketId);
    if (disposed) return;
    if (servers) byTicket.set(ticketId, servers);
    else forget(ticketId);
    publish();
  }

  function refreshOne(ticketId: string): Promise<void> {
    const running = inFlight.get(ticketId);
    if (running) return running;
    const next = refreshTicket(ticketId)
      .catch((error: unknown) => log?.warn(`Could not read the MCP servers of ticket ${ticketId}: ${error instanceof Error ? error.message : String(error)}`))
      .finally(() => inFlight.delete(ticketId));
    inFlight.set(ticketId, next);
    return next;
  }

  async function refreshAll(): Promise<void> {
    const live = sessions.list().filter((status) => LIVE.has(status.state)).map((status) => status.ticketId);
    for (const ticketId of [...byTicket.keys()]) if (!live.includes(ticketId)) forget(ticketId);
    publish();
    await Promise.all(live.map(refreshOne));
  }

  function onMessage(ticketId: string, message: SDKMessage): void {
    if (message.type !== 'system' || message.subtype !== 'init') return;
    // The init message lists the servers as the session starts; most are still pending.
    byTicket.set(ticketId, (message.mcp_servers ?? []).map(reading));
    publish();
    void refreshOne(ticketId);
  }

  const unsubscribe = sessions.subscribe(({ ticketId, message }) => onMessage(ticketId, message));
  const intervalMs = options.intervalMs ?? MCP_STATUS_INTERVAL_MS;
  const timer = intervalMs > 0 ? setInterval(() => void refreshAll(), intervalMs) : undefined;
  timer?.unref?.();

  return {
    summary: () => summariseMcpStatus(byTicket),
    refresh: (ticketId) => (ticketId ? refreshOne(ticketId) : refreshAll()),
    dispose() {
      disposed = true;
      unsubscribe();
      if (timer) clearInterval(timer);
    },
  };
}
