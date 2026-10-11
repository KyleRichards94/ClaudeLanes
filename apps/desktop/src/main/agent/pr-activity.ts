import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { TicketPrActivity } from '@agent-lanes/contracts';
import type { Emit } from '../ipc/emit';
import type { Logger } from '../logging';
import type { TicketRecordStore } from '../tickets';
import type { SessionManager } from './session-manager';

/**
 * Pull request activity (AL-269): how many PR comments a ticket's agent posted and how many threads
 * it replied to or resolved, counted from its sessions' ADO MCP tool calls (any server) once each
 * call returned without error. Kept on the ticket record, so a finished review card still says
 * "Reviewed · 4 comments" after a restart, and pushed as `agent:prActivity` as it grows.
 */
export interface PrActivityTracker {
  get(ticketId: string): Promise<TicketPrActivity | null>;
  dispose(): void;
}

export interface PrActivityTrackerOptions {
  sessions: Pick<SessionManager, 'subscribe'>;
  tickets: Pick<TicketRecordStore, 'get' | 'update'>;
  emit: Emit;
  log?: Pick<Logger, 'warn'>;
  now?: () => number;
}

export type PrActivityKind = 'comment' | 'thread';

/** What an ADO MCP tool call adds to the ticket's PR activity, or null for any other tool. */
export function prActivityKind(toolName: string): PrActivityKind | null {
  const mcp = /^mcp__.+?__(.+)$/.exec(toolName);
  if (!mcp) return null;
  const tool = mcp[1]!.toLowerCase();
  if (/^(get|list|read|search|fetch|find)_/.test(tool)) return null;
  if (/thread_status|resolve_thread|reply_to_(pull_?request|pr)_?thread/.test(tool)) return 'thread';
  if (/(pull_?request|(^|_)pr(_|$)).*comment|comment.*(pull_?request|(^|_)pr(_|$))|reply_to_(pull_?request|pr)/.test(tool)) return 'comment';
  return null;
}

export function createPrActivityTracker(options: PrActivityTrackerOptions): PrActivityTracker {
  const { tickets, emit } = options;
  const now = options.now ?? Date.now;
  /** Tool uses that would count, by id, until their result arrives. */
  const pending = new Map<string, { ticketId: string; kind: PrActivityKind }>();
  /** Record writes per ticket run one after another, so two results in one frame both count. */
  const writes = new Map<string, Promise<void>>();

  function count(ticketId: string, kind: PrActivityKind): void {
    const run = async () => {
      const at = now();
      const saved = await tickets.update(ticketId, (record) => {
        const current = record.prActivity ?? { comments: 0, threads: 0, updatedAt: at };
        return { ...record, prActivity: { comments: current.comments + (kind === 'comment' ? 1 : 0), threads: current.threads + (kind === 'thread' ? 1 : 0), updatedAt: at } };
      });
      if (!saved.ok) {
        options.log?.warn(`Could not record PR activity for ticket ${ticketId}: ${saved.message}`);
        return;
      }
      if (saved.data.prActivity) emit('agent:prActivity', { ticketId, activity: saved.data.prActivity });
    };
    const chain = (writes.get(ticketId) ?? Promise.resolve()).then(run, run);
    writes.set(ticketId, chain);
  }

  function onMessage(ticketId: string, message: SDKMessage): void {
    if (message.type === 'assistant') {
      const content: unknown = message.message.content;
      if (!Array.isArray(content)) return;
      for (const block of content as Array<{ type?: string; id?: string; name?: string }>) {
        if (block.type !== 'tool_use' || !block.id || !block.name) continue;
        const kind = prActivityKind(block.name);
        if (kind) pending.set(block.id, { ticketId, kind });
      }
    } else if (message.type === 'user') {
      const content: unknown = message.message.content;
      if (!Array.isArray(content)) return;
      for (const block of content as Array<{ type?: string; tool_use_id?: string; is_error?: boolean }>) {
        if (block.type !== 'tool_result' || !block.tool_use_id) continue;
        const use = pending.get(block.tool_use_id);
        if (!use) continue;
        pending.delete(block.tool_use_id);
        if (!block.is_error) count(use.ticketId, use.kind);
      }
    }
  }

  const unsubscribe = options.sessions.subscribe(({ ticketId, message }) => {
    try {
      onMessage(ticketId, message);
    } catch (error) {
      options.log?.warn(`PR activity tracking failed for ticket ${ticketId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return {
    async get(ticketId) {
      await writes.get(ticketId);
      return (await tickets.get(ticketId))?.prActivity ?? null;
    },
    dispose: () => unsubscribe(),
  };
}
