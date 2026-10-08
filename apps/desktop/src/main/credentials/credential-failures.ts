import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { normalizeOrgUrl } from '@agent-lanes/ado-client';
import type { AdoConnectionSummary, ConnectionSummary } from '@agent-lanes/contracts';
import type { SessionManager } from '../agent/session-manager';
import { ADO_SESSION_SERVER_NAME, type ConnectionsService } from '../connections';
import type { Emit } from '../ipc/emit';
import type { Logger } from '../logging';
import type { TicketRecordStore } from '../tickets';

/**
 * Credential failure handling (AL-048, design §8 last bullet, §13 "PAT expiry"): a 401 from Azure
 * DevOps, whether the app's own ADO client got it or the ADO MCP server inside an agent session did,
 *
 * 1. marks that organisation's connection red ("Azure DevOps refused this token…"),
 * 2. pauses only the agents whose work items belong to that organisation (interrupt + hold their
 *    input queue, AL-105); agents on other organisations, and tickets without a work item, keep running,
 * 3. raises one error toast with Reconnect, which opens Connections on that organisation's row.
 *
 * When the organisation is usable again (its token was replaced, or a re-test passed) the agents this
 * service paused resume with a short "Connection restored" user turn, without restarting anything.
 * Agents the user paused themselves are left paused.
 */
export interface CredentialFailureService {
  /** An Azure DevOps request with connection `connectionId`'s token was answered 401. */
  adoUnauthorized(connectionId: string): Promise<void>;
  /** Connections changed (`connections:changed`): resumes the agents of organisations that are usable again. */
  connectionsChanged(): Promise<void>;
  /** The tickets paused because `connectionId` was refused, waiting for a reconnect. */
  pausedFor(connectionId: string): string[];
  /** Waits for the failure and reconnect work already started (tests). */
  settled(): Promise<void>;
  /** Stops watching session output. */
  dispose(): void;
}

export interface CredentialFailureServiceOptions {
  connections: Pick<ConnectionsService, 'get' | 'list' | 'markUnauthorized'>;
  sessions: Pick<SessionManager, 'status' | 'pause' | 'resume' | 'subscribe'>;
  tickets: Pick<TicketRecordStore, 'get' | 'list'>;
  emit: Emit;
  log?: Pick<Logger, 'info' | 'warn'>;
}

/** The red row's text. */
export const ADO_UNAUTHORIZED_STATUS_MESSAGE =
  'Azure DevOps refused this token (401). It may have expired or been revoked; replace it to reconnect.';
/** The user turn a paused agent resumes with after a reconnect. */
export const CONNECTION_RESTORED_MESSAGE =
  'Connection restored: the Azure DevOps token works again. Continue where you left off; retry any Azure DevOps call that failed.';
/** Session states in which an agent is working and can be paused. */
const PAUSABLE = new Set(['starting', 'running', 'idle']);
/** Tool names of the built-in Azure DevOps MCP server inside a session (AL-108). */
const ADO_MCP_TOOL_PREFIX = `mcp__${ADO_SESSION_SERVER_NAME}__`;
/** What an ADO MCP tool result says when Azure DevOps refused the token. */
const UNAUTHORIZED_TEXT = /\b401\b|\bunauthori[sz]ed\b|TF400813/i;
/** Tool uses remembered per ticket while their results are awaited. */
const PENDING_TOOL_USES_LIMIT = 200;

export function adoUnauthorizedToastId(connectionId: string): string {
  return `ado-unauthorized:${connectionId}`;
}

function sameOrg(a: string, b: string): boolean {
  const left = normalizeOrgUrl(a);
  const right = normalizeOrgUrl(b);
  return (left.ok ? left.data : a).toLowerCase() === (right.ok ? right.data : b).toLowerCase();
}

function ticketList(ids: readonly string[]): string {
  const shown = ids.slice(0, 3).map((id) => (/^\d+$/.test(id) ? `#${id}` : id));
  return ids.length > 3 ? `${shown.join(', ')} and ${ids.length - 3} more` : shown.join(', ');
}

function agents(count: number): string {
  return count === 1 ? '1 agent' : `${count} agents`;
}

/** Text of a tool result block's content (a string, or text blocks). */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block: unknown) => (block && typeof block === 'object' && 'text' in block && typeof block.text === 'string' ? block.text : ''))
    .join('\n');
}

export function createCredentialFailureService(options: CredentialFailureServiceOptions): CredentialFailureService {
  const { connections, sessions, tickets, emit, log } = options;
  /** Refused connections → the tickets this service paused for them. */
  const failed = new Map<string, Set<string>>();
  /** Per ticket: ADO MCP tool use ids whose results are awaited. */
  const adoToolUses = new Map<string, Set<string>>();
  /** Failure and reconnect work runs one step at a time, so a 401 and a reconnect never interleave. */
  let chain: Promise<void> = Promise.resolve();

  const serial = (task: () => Promise<void>): Promise<void> => {
    const run = chain.then(task, task).catch((cause: unknown) => {
      log?.warn(`Credential failure handling failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    });
    chain = run;
    return run;
  };

  async function adoConnectionOf(ticketId: string): Promise<AdoConnectionSummary | undefined> {
    const record = await tickets.get(ticketId);
    if (!record?.ado) return undefined;
    const orgUrl = record.ado.orgUrl;
    return (await connections.list()).find((row): row is AdoConnectionSummary => row.kind === 'ado' && sameOrg(row.orgUrl, orgUrl));
  }

  async function handleUnauthorized(connectionId: string): Promise<void> {
    const connection = await connections.get(connectionId);
    if (connection?.kind !== 'ado') return;
    const firstFailure = !failed.has(connectionId);
    // Red first: the change this emits must not look like a reconnect.
    await connections.markUnauthorized(connectionId, ADO_UNAUTHORIZED_STATUS_MESSAGE);
    const paused = failed.get(connectionId) ?? new Set<string>();
    failed.set(connectionId, paused);

    const newlyPaused: string[] = [];
    for (const record of await tickets.list()) {
      if (!record.ado || !sameOrg(record.ado.orgUrl, connection.orgUrl) || paused.has(record.id)) continue;
      if (!PAUSABLE.has(sessions.status(record.id).state)) continue;
      const result = await sessions.pause(record.id);
      if (result.ok) {
        paused.add(record.id);
        newlyPaused.push(record.id);
      } else {
        log?.warn(`Could not pause ticket ${record.id} after ${connection.name} refused its token: ${result.message}`);
      }
    }
    if (!firstFailure && newlyPaused.length === 0) return;

    log?.info(`Azure DevOps refused the token of ${connection.name}; paused ${newlyPaused.length > 0 ? newlyPaused.join(', ') : 'no agents'}.`);
    const all = [...paused];
    emit('toast', {
      id: adoUnauthorizedToastId(connectionId),
      tone: 'error',
      title: `Azure DevOps refused the token for ${connection.name}`,
      body:
        all.length > 0
          ? `${agents(all.length)} on ${connection.name} paused (${ticketList(all)}). Reconnect to resume; agents on other organisations keep running.`
          : `The token may have expired or been revoked. Reconnect to keep working with ${connection.name}.`,
      actions: [{ label: 'Reconnect', intent: { type: 'openConnections', connectionId } }],
    });
  }

  function usable(connection: ConnectionSummary | undefined): boolean {
    return connection?.kind === 'ado' && connection.status !== 'error' && !connection.needsReconnect;
  }

  async function handleChanged(): Promise<void> {
    for (const [connectionId, paused] of [...failed]) {
      const connection = await connections.get(connectionId);
      if (connection === undefined) {
        // Removed: nothing will reconnect it, and its agents stay paused for the user.
        failed.delete(connectionId);
        continue;
      }
      if (!usable(connection)) continue;
      failed.delete(connectionId);

      const resumed: string[] = [];
      for (const ticketId of paused) {
        // Resumed by the user meanwhile, or the session ended: nothing to do.
        if (sessions.status(ticketId).state !== 'paused') continue;
        const result = sessions.resume(ticketId, { opening: CONNECTION_RESTORED_MESSAGE });
        if (result.ok) resumed.push(ticketId);
        else log?.warn(`Could not resume ticket ${ticketId} after ${connection.name} reconnected: ${result.message}`);
      }
      log?.info(`${connection.name} reconnected; resumed ${resumed.length > 0 ? resumed.join(', ') : 'no agents'}.`);
      emit('toast', {
        id: adoUnauthorizedToastId(connectionId),
        tone: 'info',
        title: `${connection.name} reconnected`,
        body: resumed.length > 0 ? `${agents(resumed.length)} resumed (${ticketList(resumed)}).` : 'Azure DevOps accepts the token again.',
      });
    }
  }

  /** The ADO MCP server inside a session reports a 401 as its tool result. */
  function watch(ticketId: string, message: SDKMessage): void {
    if (message.type === 'assistant') {
      const content: unknown = message.message.content;
      if (!Array.isArray(content)) return;
      for (const block of content as Array<{ type?: string; id?: string; name?: string }>) {
        if (block.type !== 'tool_use' || typeof block.id !== 'string' || !block.name?.startsWith(ADO_MCP_TOOL_PREFIX)) continue;
        const ids = adoToolUses.get(ticketId) ?? new Set<string>();
        if (ids.size >= PENDING_TOOL_USES_LIMIT) ids.delete(ids.values().next().value as string);
        ids.add(block.id);
        adoToolUses.set(ticketId, ids);
      }
      return;
    }
    if (message.type !== 'user') return;
    const ids = adoToolUses.get(ticketId);
    const content: unknown = message.message.content;
    if (!ids || !Array.isArray(content)) return;
    for (const block of content as Array<{ type?: string; tool_use_id?: string; content?: unknown; is_error?: boolean }>) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string' || !ids.delete(block.tool_use_id)) continue;
      if (!UNAUTHORIZED_TEXT.test(resultText(block.content))) continue;
      void serial(async () => {
        const connection = await adoConnectionOf(ticketId);
        if (connection) await handleUnauthorized(connection.id);
        else log?.warn(`The Azure DevOps MCP server of ticket ${ticketId} was refused, but no connection matches its organisation.`);
      });
    }
  }

  const unsubscribe = sessions.subscribe(({ ticketId, message }) => watch(ticketId, message));

  return {
    adoUnauthorized: (connectionId) => serial(() => handleUnauthorized(connectionId)),
    connectionsChanged: () => (failed.size === 0 ? Promise.resolve() : serial(handleChanged)),
    pausedFor: (connectionId) => [...(failed.get(connectionId) ?? [])],
    settled: () => chain,
    dispose() {
      unsubscribe();
      adoToolUses.clear();
    },
  };
}
