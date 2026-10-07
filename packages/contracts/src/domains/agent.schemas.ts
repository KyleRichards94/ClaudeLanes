import { z } from 'zod';
import type { InvokeContract } from '../contract';
import { TicketEventEnvelopeSchema, TicketIdSchema } from '../events';
import type { Model } from '../vocabulary';
import type { AGENT_EVENT_CHANNELS, AGENT_INVOKE_CHANNELS } from './agent.names';

// ── Session manager (AL-100, design §4 Session manager, §7) ───────────────────────────────────────

/**
 * The Agent SDK model id behind each model card (Decision D10). The one place model ids are spelled;
 * sessions start with it and a live model change (AL-106) switches to it.
 */
export const SDK_MODEL_IDS = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-4-5',
} as const satisfies Record<Model, string>;

/**
 * Where a ticket's agent session is:
 * - `none`: no session has run for the ticket since the app started;
 * - `starting`: `claude` is being started;
 * - `running`: a turn is in progress;
 * - `idle`: the turn ended and the session waits for the next user turn;
 * - `stopped`: the app closed the session (its process is gone);
 * - `lost`: the session ended without being asked to (crash, process exit); AL-110 recovers it.
 */
export const AGENT_SESSION_STATES = ['none', 'starting', 'running', 'idle', 'stopped', 'lost'] as const;
export const AgentSessionStateSchema = z.enum(AGENT_SESSION_STATES);
export type AgentSessionState = z.infer<typeof AgentSessionStateSchema>;

/** A ticket's session as the card and drill-in see it. Never holds the credential it runs with. */
export const AgentSessionStatusSchema = z.object({
  ticketId: TicketIdSchema,
  state: AgentSessionStateSchema,
  /** The Agent SDK session id once `claude` reported it; what `resume` takes (AL-110). */
  sessionId: z.string().min(1).max(200).nullable(),
  /** Why the session stopped or was lost, for the user; null otherwise. */
  message: z.string().max(2000).nullable(),
});
export type AgentSessionStatus = z.infer<typeof AgentSessionStatusSchema>;

/** Request of `agent:getStatus` and `agent:getTranscript`: one ticket. */
export const AgentTicketRequestSchema = z.strictObject({ ticketId: TicketIdSchema });
export type AgentTicketRequest = z.infer<typeof AgentTicketRequestSchema>;

// ── Output stream (AL-102, design §6 Live events, artboard 3 Output) ─────────────────────────────

/** Longest one-line detail or summary sent for a row; the full text stays in the session. */
export const OUTPUT_LINE_LIMIT = 500;
/** Longest text block sent in one event. */
export const OUTPUT_TEXT_LIMIT = 20_000;

const OutputLineSchema = z.string().max(OUTPUT_LINE_LIMIT);

/** Which kind of tool row (artboard 3: Read / Spawn / Edit / Bash with a mono detail). */
export const OUTPUT_TOOL_KINDS = ['read', 'edit', 'write', 'bash', 'grep', 'glob', 'spawn', 'mcp', 'other'] as const;
export const OutputToolKindSchema = z.enum(OUTPUT_TOOL_KINDS);
export type OutputToolKind = z.infer<typeof OutputToolKindSchema>;

/** Fields every output item has. */
const OutputItemBase = z.object({
  /**
   * The Agent/Task tool use a sub-agent's output belongs to; null for the lead agent. The drill-in's
   * Output tab shows the lead agent; AL-107 nests sub-agent output under its tree node.
   */
  parentToolUseId: z.string().max(200).nullable(),
});

/**
 * One piece of a ticket's output, normalised from the Agent SDK's messages:
 * - `text-delta`: streamed assistant text (the line with the caret); superseded by the `text` with the same `streamId`;
 * - `text`: a finished block of assistant prose;
 * - `tool`: a tool row ("Read · OnSite/Forms/frmJobControl.vb · 1,842 lines"). A later `tool` with the same
 *   `rowId` replaces the row (e.g. a Spawn row gaining its third sub-agent);
 * - `tool-result`: what a tool call returned, summary only; its `stats` replace the row's;
 * - `system`: a line from the app ("Plan approved by Kyle · moved to Implementing");
 * - `result`: a turn ended: usage, cost and duration.
 */
export const AgentOutputItemSchema = z.discriminatedUnion('kind', [
  OutputItemBase.extend({
    kind: z.literal('text-delta'),
    /** The API message id the text streams into. */
    streamId: z.string().max(200),
    text: z.string().max(OUTPUT_TEXT_LIMIT),
  }),
  OutputItemBase.extend({
    kind: z.literal('text'),
    streamId: z.string().max(200),
    text: z.string().max(OUTPUT_TEXT_LIMIT),
  }),
  OutputItemBase.extend({
    kind: z.literal('tool'),
    rowId: z.string().max(200),
    /** The tool uses shown on this row (several for a Spawn row). */
    toolUseIds: z.array(z.string().max(200)).min(1).max(64),
    tool: OutputToolKindSchema,
    /** The row's tag: Read, Edit, Write, Bash, Grep, Glob, Spawn, MCP or the tool's own name. */
    label: z.string().min(1).max(100),
    /** One line in mono: a worktree-relative path, a command, sub-agent names, `server · tool`. */
    detail: OutputLineSchema,
    /** `+214 −0`, `1,842 lines`, `0 errors · 2 warnings`, `3 sub-agents`; null until known. */
    stats: OutputLineSchema.nullable(),
  }),
  OutputItemBase.extend({
    kind: z.literal('tool-result'),
    rowId: z.string().max(200),
    toolUseId: z.string().max(200),
    isError: z.boolean(),
    /** First line of what the tool returned, or its error. */
    summary: OutputLineSchema,
    /** Replaces the row's stats when not null. */
    stats: OutputLineSchema.nullable(),
  }),
  OutputItemBase.extend({
    kind: z.literal('system'),
    text: OutputLineSchema,
  }),
  OutputItemBase.extend({
    kind: z.literal('result'),
    /** `success`, or how the turn failed (`error_max_turns`, `error_during_execution`, …). */
    subtype: z.string().max(100),
    isError: z.boolean(),
    durationMs: z.number().nonnegative(),
    numTurns: z.int().nonnegative(),
    /** USD; shown in a tooltip only (AL-113). */
    costUsd: z.number().nonnegative(),
    usage: z.object({
      inputTokens: z.int().nonnegative(),
      outputTokens: z.int().nonnegative(),
      cacheReadInputTokens: z.int().nonnegative(),
      cacheCreationInputTokens: z.int().nonnegative(),
    }),
  }),
]);
export type AgentOutputItem = z.infer<typeof AgentOutputItemSchema>;

/**
 * `agent:output`: one output item of a ticket. `seq` increases by one per ticket for live output, so a
 * renderer that backfills with `agent:getTranscript` and also receives live events merges them by
 * `seq` with no gap or duplicate. History read back from the saved session (after a restart) has
 * seqs at or below zero, oldest lowest.
 */
export const AgentOutputEventSchema = TicketEventEnvelopeSchema.extend({
  seq: z.int(),
  item: AgentOutputItemSchema,
});
export type AgentOutputEvent = z.infer<typeof AgentOutputEventSchema>;

/** Most events main keeps per ticket; the renderer keeps the same. */
export const TRANSCRIPT_CAPACITY = 5_000;

/** `agent:getTranscript`: the ticket's buffered output, oldest first, for a reloaded renderer or a newly opened drill-in. */
export const AgentTranscriptSchema = z.object({
  ticketId: TicketIdSchema,
  events: z.array(AgentOutputEventSchema).max(TRANSCRIPT_CAPACITY),
  /** The newest seq main has handed out for this ticket (0 when none): live events after it are new. */
  lastSeq: z.int(),
});
export type AgentTranscript = z.infer<typeof AgentTranscriptSchema>;

export const agentInvokeContracts = {
  'agent:getStatus': { request: AgentTicketRequestSchema, response: AgentSessionStatusSchema },
  'agent:getTranscript': { request: AgentTicketRequestSchema, response: AgentTranscriptSchema },
} as const satisfies Record<(typeof AGENT_INVOKE_CHANNELS)[number], InvokeContract>;

// Event payloads start as the ticket envelope `{ ticketId, at }` (AL-012); the owning tickets add their fields.

/** `agent:stage`: the agent moved its ticket to another stage through `set_stage` (AL-103). */
export const AgentStageEventSchema = TicketEventEnvelopeSchema.extend({});
export type AgentStageEvent = z.infer<typeof AgentStageEventSchema>;

/** `agent:subagent`: a sub-agent started, progressed or finished (AL-107). */
export const AgentSubagentEventSchema = TicketEventEnvelopeSchema.extend({});
export type AgentSubagentEvent = z.infer<typeof AgentSubagentEventSchema>;

/** `agent:gate`: a stage gate is waiting for the user, or was resolved (AL-104). */
export const AgentGateEventSchema = TicketEventEnvelopeSchema.extend({});
export type AgentGateEvent = z.infer<typeof AgentGateEventSchema>;

/** `agent:status`: the session's run state changed (AL-100; queued and paused come with AL-111, AL-105). */
export const AgentStatusEventSchema = TicketEventEnvelopeSchema.extend({
  state: AgentSessionStateSchema,
  sessionId: AgentSessionStatusSchema.shape.sessionId,
  message: AgentSessionStatusSchema.shape.message,
});
export type AgentStatusEvent = z.infer<typeof AgentStatusEventSchema>;

export const agentEventContracts = {
  'agent:output': AgentOutputEventSchema,
  'agent:stage': AgentStageEventSchema,
  'agent:subagent': AgentSubagentEventSchema,
  'agent:gate': AgentGateEventSchema,
  'agent:status': AgentStatusEventSchema,
} as const satisfies Record<(typeof AGENT_EVENT_CHANNELS)[number], z.ZodType>;
