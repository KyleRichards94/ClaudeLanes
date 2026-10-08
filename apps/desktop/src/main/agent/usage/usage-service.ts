import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { emptyAgentUsage, type AgentUsage, type ContextUsage } from '@agent-lanes/contracts';
import type { Emit } from '../../ipc/emit';
import type { Logger } from '../../logging';
import type { SessionManager } from '../session-manager';

/**
 * Usage per ticket session (AL-113, artboard 3 "Session cc-71273 · 1h 12m · 412k tokens", Lead agent
 * "212k tokens"): aggregated from the session's messages as they stream.
 *
 * - Session totals come from the latest result's `modelUsage` and `total_cost_usd`. In a streaming
 *   session both are running totals that cover the lead agent and its sub-agents, so the latest
 *   result is read, never summed (SDK docs). A result with no per-model usage (a crash or start-up
 *   error) keeps the totals as they were.
 * - The lead agent's tokens are the main loop's `usage`, which is per turn, summed over turns.
 * - Each sub-agent's tokens come from its assistant messages (`parent_tool_use_id` set), one usage
 *   per API message id, since a message streamed in parts repeats its usage.
 * - After each turn the context window is read with `getContextUsage()`.
 *
 * Every change is pushed as `agent:usage`; `agent:getUsage` backfills a reloaded renderer.
 */
export interface UsageService {
  get(ticketId: string): AgentUsage;
  dispose(): void;
}

export interface UsageServiceOptions {
  sessions: Pick<SessionManager, 'subscribe' | 'contextUsage'>;
  emit: Emit;
  log?: Pick<Logger, 'debug'>;
  now?: () => number;
}

interface UsageNumbers {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

interface ModelUsageNumbers {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

interface TicketUsage {
  usage: AgentUsage;
  /** Sub-agent tool use id → API message id → tokens. */
  subagents: Map<string, Map<string, number>>;
}

const count = (value: number | null | undefined): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/** Input, output, cache reads and cache writes of one API usage block. */
export function usageTokens(usage: UsageNumbers | null | undefined): number {
  if (!usage) return 0;
  return count(usage.input_tokens) + count(usage.output_tokens) + count(usage.cache_read_input_tokens) + count(usage.cache_creation_input_tokens);
}

/** The session totals from a result's per-model usage; null when it has none. */
export function modelUsageTotals(modelUsage: Record<string, ModelUsageNumbers> | null | undefined) {
  const models = Object.values(modelUsage ?? {});
  if (models.length === 0) return null;
  const totals = { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
  for (const model of models) {
    totals.inputTokens += count(model.inputTokens);
    totals.outputTokens += count(model.outputTokens);
    totals.cacheReadInputTokens += count(model.cacheReadInputTokens);
    totals.cacheCreationInputTokens += count(model.cacheCreationInputTokens);
  }
  return { ...totals, totalTokens: totals.inputTokens + totals.outputTokens + totals.cacheReadInputTokens + totals.cacheCreationInputTokens };
}

export function createUsageService(options: UsageServiceOptions): UsageService {
  const { sessions, emit } = options;
  const now = options.now ?? Date.now;
  const tickets = new Map<string, TicketUsage>();

  function entry(ticketId: string): TicketUsage {
    let found = tickets.get(ticketId);
    if (!found) {
      found = { usage: emptyAgentUsage(ticketId), subagents: new Map() };
      tickets.set(ticketId, found);
    }
    return found;
  }

  function publish(ticketId: string, ticket: TicketUsage, change: Partial<AgentUsage>): void {
    ticket.usage = { ...ticket.usage, ...change, updatedAt: now() };
    emit('agent:usage', { ticketId, usage: ticket.usage });
  }

  function subagentList(ticket: TicketUsage): AgentUsage['subagents'] {
    return [...ticket.subagents].map(([toolUseId, messages]) => ({ toolUseId, tokens: [...messages.values()].reduce((sum, tokens) => sum + tokens, 0) }));
  }

  async function measureContext(ticketId: string): Promise<void> {
    const measured = await sessions.contextUsage(ticketId);
    if (!measured.ok) {
      options.log?.debug(`No context usage for ticket ${ticketId}: ${measured.message}`);
      return;
    }
    const context: ContextUsage = {
      usedTokens: count(measured.data.totalTokens),
      maxTokens: count(measured.data.maxTokens),
      percentage: Math.min(100, Math.max(0, Number.isFinite(measured.data.percentage) ? measured.data.percentage : 0)),
    };
    const ticket = entry(ticketId);
    const previous = ticket.usage.context;
    if (previous && previous.usedTokens === context.usedTokens && previous.maxTokens === context.maxTokens) return;
    publish(ticketId, ticket, { context });
  }

  function handle(ticketId: string, message: SDKMessage): void {
    if (message.type === 'assistant' && message.parent_tool_use_id) {
      const tokens = usageTokens(message.message.usage as UsageNumbers | undefined);
      if (tokens === 0) return;
      const ticket = entry(ticketId);
      const messages = ticket.subagents.get(message.parent_tool_use_id) ?? new Map<string, number>();
      ticket.subagents.set(message.parent_tool_use_id, messages);
      messages.set(message.message.id ?? message.uuid, tokens);
      return;
    }
    if (message.type !== 'result') return;
    const ticket = entry(ticketId);
    const totals = modelUsageTotals(message.modelUsage as Record<string, ModelUsageNumbers> | undefined);
    const reported = Number.isFinite(message.total_cost_usd) ? Math.max(0, message.total_cost_usd) : 0;
    const cost = reported > 0 || totals ? reported : ticket.usage.costUsd;
    publish(ticketId, ticket, {
      ...(totals ?? {}),
      costUsd: cost,
      leadTokens: ticket.usage.leadTokens + usageTokens(message.usage as UsageNumbers | undefined),
      subagents: subagentList(ticket),
      turns: ticket.usage.turns + 1,
    });
    void measureContext(ticketId);
  }

  const unsubscribe = sessions.subscribe(({ ticketId, message }) => handle(ticketId, message));

  return {
    get: (ticketId) => tickets.get(ticketId)?.usage ?? emptyAgentUsage(ticketId),
    dispose: unsubscribe,
  };
}
