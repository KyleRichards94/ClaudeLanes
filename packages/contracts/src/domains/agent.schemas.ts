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

/** `agent:getStatus`: the ticket's session, for a renderer that starts or reloads mid-run. */
export const AgentTicketRequestSchema = z.strictObject({ ticketId: TicketIdSchema });
export type AgentTicketRequest = z.infer<typeof AgentTicketRequestSchema>;

export const agentInvokeContracts = {
  'agent:getStatus': { request: AgentTicketRequestSchema, response: AgentSessionStatusSchema },
} as const satisfies Record<(typeof AGENT_INVOKE_CHANNELS)[number], InvokeContract>;

// Event payloads start as the ticket envelope `{ ticketId, at }` (AL-012); the owning tickets add their fields.

/** `agent:output`: one normalised piece of session output (AL-102 adds the output union). */
export const AgentOutputEventSchema = TicketEventEnvelopeSchema.extend({});
export type AgentOutputEvent = z.infer<typeof AgentOutputEventSchema>;

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
