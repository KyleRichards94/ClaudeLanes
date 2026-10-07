import type { z } from 'zod';
import type { InvokeContract } from '../contract';
import { TicketEventEnvelopeSchema } from '../events';
import type { AGENT_EVENT_CHANNELS, AGENT_INVOKE_CHANNELS } from './agent.names';

export const agentInvokeContracts = {} as const satisfies Record<(typeof AGENT_INVOKE_CHANNELS)[number], InvokeContract>;

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

/** `agent:status`: the session's run state changed, e.g. running, paused, queued or lost (AL-100, AL-110, AL-111). */
export const AgentStatusEventSchema = TicketEventEnvelopeSchema.extend({});
export type AgentStatusEvent = z.infer<typeof AgentStatusEventSchema>;

export const agentEventContracts = {
  'agent:output': AgentOutputEventSchema,
  'agent:stage': AgentStageEventSchema,
  'agent:subagent': AgentSubagentEventSchema,
  'agent:gate': AgentGateEventSchema,
  'agent:status': AgentStatusEventSchema,
} as const satisfies Record<(typeof AGENT_EVENT_CHANNELS)[number], z.ZodType>;
