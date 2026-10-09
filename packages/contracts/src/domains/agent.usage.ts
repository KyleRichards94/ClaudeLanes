import { z } from 'zod';
import { TicketEventEnvelopeSchema, TicketIdSchema } from '../events';

/**
 * Session usage (AL-113, artboard 3: "Session cc-71273 · 1h 12m · 412k tokens", Lead agent "212k
 * tokens"): what a ticket's Claude Code session has used so far, aggregated in main from the Agent
 * SDK's messages. Token counts include cache reads and cache writes, as Claude Code's own totals do.
 */

const TokenCountSchema = z.int().nonnegative();

/** One sub-agent's tokens, keyed by the Agent/Task tool use that started it (AL-107 names it). */
export const SubagentUsageSchema = z.object({
  toolUseId: z.string().min(1).max(200),
  tokens: TokenCountSchema,
});
export type SubagentUsage = z.infer<typeof SubagentUsageSchema>;

/** The context window as `getContextUsage()` last reported it; null until it has been asked. */
export const ContextUsageSchema = z.object({
  usedTokens: TokenCountSchema,
  maxTokens: TokenCountSchema,
  /** 0 to 100. */
  percentage: z.number().min(0).max(100),
});
export type ContextUsage = z.infer<typeof ContextUsageSchema>;

export const AgentUsageSchema = z.object({
  ticketId: TicketIdSchema,
  /**
   * Every token of the session: the latest result's per-model totals (the SDK's `modelUsage`, which
   * is cumulative in a streaming session and covers sub-agents too). Shown on the session pill.
   */
  totalTokens: TokenCountSchema,
  inputTokens: TokenCountSchema,
  outputTokens: TokenCountSchema,
  cacheReadInputTokens: TokenCountSchema,
  cacheCreationInputTokens: TokenCountSchema,
  /** The lead agent's own tokens: the main loop's per-turn `usage`, summed over turns (Lead agent card). */
  leadTokens: TokenCountSchema,
  /**
   * Tokens of the turn in progress, from its assistant messages so far (AL-257): the usage strip adds
   * them to `totalTokens` while the turn runs; 0 once the result has folded them in. Absent on older senders.
   */
  turnTokens: TokenCountSchema.default(0),
  /** How often the context was compacted this session (AL-257). Absent on older senders. */
  compactions: z.int().nonnegative().default(0),
  /** Sub-agents' tokens from their assistant messages, oldest first. */
  subagents: z.array(SubagentUsageSchema).max(500),
  /** Estimated USD (`total_cost_usd`); shown in a tooltip only. */
  costUsd: z.number().nonnegative(),
  /** Turns that ended (results seen). */
  turns: z.int().nonnegative(),
  context: ContextUsageSchema.nullable(),
  /** When a message last changed these numbers; null when nothing has been used yet. */
  updatedAt: z.int().nonnegative().nullable(),
});
export type AgentUsage = z.infer<typeof AgentUsageSchema>;

/** `agent:usage`: the ticket's usage after a turn ended or the context window was measured. */
export const AgentUsageEventSchema = TicketEventEnvelopeSchema.extend({ usage: AgentUsageSchema });
export type AgentUsageEvent = z.infer<typeof AgentUsageEventSchema>;

/** A ticket with no usage yet. */
export function emptyAgentUsage(ticketId: string): AgentUsage {
  return {
    ticketId,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    leadTokens: 0,
    turnTokens: 0,
    compactions: 0,
    subagents: [],
    costUsd: 0,
    turns: 0,
    context: null,
    updatedAt: null,
  };
}

/** `412k tokens`, `1.2M tokens`, `850 tokens` (artboard 3). */
export function formatTokenCount(tokens: number): string {
  const value = Math.max(0, Math.round(tokens));
  if (value < 1_000) return `${value} tokens`;
  if (value < 999_500) return `${Math.round(value / 1_000)}k tokens`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, '')}M tokens`;
}

/** `$1.24`, `<$0.01` for the cost tooltip. */
export function formatCostUsd(costUsd: number): string {
  if (costUsd > 0 && costUsd < 0.01) return '<$0.01';
  return `$${costUsd.toFixed(2)}`;
}
