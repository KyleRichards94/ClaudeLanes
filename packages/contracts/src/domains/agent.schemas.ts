import { z } from 'zod';
import type { InvokeContract } from '../contract';
import { EventEnvelopeSchema, TicketEventEnvelopeSchema, TicketIdSchema } from '../events';
import { GateSchema, LaneSchema, StageSchema, type Model } from '../vocabulary';
import { StageGatesSchema } from './settings.schemas';
import { AgentUsageEventSchema, AgentUsageSchema } from './agent.usage';
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
 * - `paused`: the user paused it (AL-105): the turn was interrupted and new messages wait for Resume;
 * - `stopped`: the app closed the session (its process is gone);
 * - `lost`: the session ended without being asked to (crash, process exit); AL-110 recovers it.
 */
export const AGENT_SESSION_STATES = ['none', 'starting', 'running', 'idle', 'paused', 'stopped', 'lost'] as const;
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

// ── Stage gates (AL-104, design §9 step 2, artboard 2 Stage gates, artboard 6 "Needs approval") ──

/**
 * A stage gate waiting for the user. `stage` is the gated stage whose approval is awaited: `planning`
 * ("approve plan") holds the move to Implementing, `create-pr` ("approve PR") the move into Create PR.
 */
export const PendingGateSchema = z.object({
  stage: StageSchema,
  /** The move the agent asked for with `set_stage`. */
  from: LaneSchema,
  to: StageSchema,
  /** The agent's summary of the work to approve ("Plan ready: …"). */
  summary: z.string().max(1000).nullable(),
  openedAt: z.int().nonnegative(),
});
export type PendingGate = z.infer<typeof PendingGateSchema>;

/** How a gate ended: approved (by the user, or by switching the gate off), sent back, or the session ended first. */
export const GATE_OUTCOMES = ['approved', 'changes-requested', 'cancelled'] as const;
export const GateOutcomeSchema = z.enum(GATE_OUTCOMES);
export type GateOutcome = z.infer<typeof GateOutcomeSchema>;

/** `agent:resolveGate`: Approve, or Request changes with a note the agent reads. */
export const ResolveGateRequestSchema = z.strictObject({
  ticketId: TicketIdSchema,
  decision: z.enum(['approve', 'request-changes']),
  /** What to change; sent to the agent as the tool result. */
  note: z.string().max(4000).optional(),
});
export type ResolveGateRequest = z.infer<typeof ResolveGateRequestSchema>;

/** `resolved` is false when no gate was waiting (e.g. it was already decided). */
export const ResolveGateResponseSchema = z.object({ resolved: z.boolean() });

/** `agent:setGate`: switch one stage of a ticket between Auto and Needs approval (drill-in, AL-171). */
export const SetGateRequestSchema = z.strictObject({
  ticketId: TicketIdSchema,
  stage: StageSchema,
  gate: GateSchema,
});
export type SetGateRequest = z.infer<typeof SetGateRequestSchema>;

/** The ticket's gates after the change; `released` when switching a gate off let a waiting move through. */
export const SetGateResponseSchema = z.object({ gates: StageGatesSchema, released: z.boolean() });
export type SetGateResponse = z.infer<typeof SetGateResponseSchema>;

/** `agent:getGate`: the gate waiting for the user, for a renderer that reloads while one waits. */
export const GetGateResponseSchema = z.object({ gate: PendingGateSchema.nullable() });

// ── Messages, skills and pause (AL-105, design §7 Skills, artboard 3 composer) ─────────────────────

/** Longest message the composer sends. */
export const AGENT_MESSAGE_LIMIT = 20_000;

/** A skill name as Claude Code lists it (`code-review`, `osc-blazor-cutover-invoke`, `plugin:skill`). */
export const SKILL_NAME_PATTERN = /^[A-Za-z0-9][\w.:-]{0,199}$/;

/**
 * What a skill chip sends: `/skill-name` as the next user turn, exactly as typed in the terminal, so
 * Claude Code runs it as a slash command (design §7 Skills).
 */
export function skillCommand(skill: string): string {
  const name = skill.startsWith('/') ? skill.slice(1) : skill;
  if (!SKILL_NAME_PATTERN.test(name)) throw new Error(`Not a skill name: ${skill}`);
  return `/${name}`;
}

/**
 * `agent:send`: a message from the composer, or a skill chip's `/skill-name`. `next` (default) is
 * delivered when the current turn ends, without stopping it; `now` ("steer now") at the next tool
 * boundary (D11).
 */
export const SendMessageRequestSchema = z.strictObject({
  ticketId: TicketIdSchema,
  text: z.string().trim().min(1).max(AGENT_MESSAGE_LIMIT),
  priority: z.enum(['next', 'now']).optional(),
});
export type SendMessageRequest = z.input<typeof SendMessageRequestSchema>;

/** `held`: the session is paused, so the message waits for Resume. */
export const SendMessageResponseSchema = z.object({ held: z.boolean() });
export type SendMessageResponse = z.infer<typeof SendMessageResponseSchema>;

// ── MCP servers of agent sessions (AL-108, design §7 MCP servers, artboard 1 "MCP online") ─────────

/** A server's state as Claude Code reports it (`mcpServerStatus()`). */
export const MCP_SERVER_STATES = ['connected', 'pending', 'failed', 'needs-auth', 'disabled'] as const;
export const McpServerStateSchema = z.enum(MCP_SERVER_STATES);
export type McpServerState = z.infer<typeof McpServerStateSchema>;

/** Longest server error sent to the renderer. */
export const MCP_ERROR_LIMIT = 500;

/** One MCP server across the running sessions: the worst state any session reports for it. */
export const McpSessionServerSchema = z.object({
  /** The name the sessions know the server by (`azure-devops`, `agent_lanes`, a user server's name). */
  name: z.string().min(1).max(200),
  state: McpServerStateSchema,
  /** Why it failed, when a session said; null otherwise. Never holds the server's token. */
  error: z.string().max(MCP_ERROR_LIMIT).nullable(),
  /** The tickets whose sessions run the server. */
  ticketIds: z.array(TicketIdSchema).max(200),
});
export type McpSessionServer = z.infer<typeof McpSessionServerSchema>;

/**
 * The header pill (artboard 1): `online` when no running session has a failing server ("MCP online"),
 * `failing` when one does ("1 MCP failing", amber, the names on hover), `none` when no session runs.
 */
export const McpStatusSummarySchema = z.object({
  state: z.enum(['none', 'online', 'failing']),
  /** Every server of the running sessions, failing ones first, then by name. */
  servers: z.array(McpSessionServerSchema).max(200),
});
export type McpStatusSummary = z.infer<typeof McpStatusSummarySchema>;

/** Whether a server counts as failing on the pill: it failed to start or needs a sign-in. */
export function isFailingMcpState(state: McpServerState): boolean {
  return state === 'failed' || state === 'needs-auth';
}

// ── Permission prompts of headless sessions (AL-109, design §4, Q9, Decision D18) ───────────────────

/** Longest prompt line or tool detail sent for a permission request. */
export const PERMISSION_TEXT_LIMIT = 500;

/**
 * A tool call outside the ticket's permission policy, waiting for Allow once / Allow for this ticket
 * / Deny ("Needs you · allow Bash" on the card).
 */
export const PermissionRequestSchema = z.object({
  requestId: z.string().min(1).max(200),
  /** The tool as the card names it: `Bash`, `WebFetch`, `azure-devops · wit_update_work_item`. */
  tool: z.string().min(1).max(200),
  /** What the agent wants to do, one line ("Claude wants to run npm install"). */
  title: z.string().min(1).max(PERMISSION_TEXT_LIMIT),
  /** The command, path or URL in mono; null when the tool has none. */
  detail: z.string().max(PERMISSION_TEXT_LIMIT).nullable(),
  openedAt: z.int().nonnegative(),
});
export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;

export const PERMISSION_DECISIONS = ['allow-once', 'allow-ticket', 'deny'] as const;
export const PermissionDecisionSchema = z.enum(PERMISSION_DECISIONS);
export type PermissionDecision = z.infer<typeof PermissionDecisionSchema>;

/** `agent:resolvePermission`: the user's answer to one waiting request. */
export const ResolvePermissionRequestSchema = z.strictObject({
  ticketId: TicketIdSchema,
  requestId: PermissionRequestSchema.shape.requestId,
  decision: PermissionDecisionSchema,
});
export type ResolvePermissionRequest = z.infer<typeof ResolvePermissionRequestSchema>;

/** `resolved` is false when the request no longer waits (answered elsewhere, or its turn ended). */
export const ResolvePermissionResponseSchema = z.object({ resolved: z.boolean() });

/** `agent:getPermission`: the ticket's oldest waiting request, for a renderer that reloads while one waits. */
export const GetPermissionResponseSchema = z.object({ request: PermissionRequestSchema.nullable() });
export type GetPermissionResponse = z.infer<typeof GetPermissionResponseSchema>;

export const agentInvokeContracts = {
  'agent:getStatus': { request: AgentTicketRequestSchema, response: AgentSessionStatusSchema },
  'agent:getTranscript': { request: AgentTicketRequestSchema, response: AgentTranscriptSchema },
  'agent:resolveGate': { request: ResolveGateRequestSchema, response: ResolveGateResponseSchema },
  'agent:setGate': { request: SetGateRequestSchema, response: SetGateResponseSchema },
  'agent:getGate': { request: AgentTicketRequestSchema, response: GetGateResponseSchema },
  'agent:send': { request: SendMessageRequestSchema, response: SendMessageResponseSchema },
  /** Interrupts the turn; later messages wait for Resume. */
  'agent:pause': { request: AgentTicketRequestSchema, response: AgentSessionStatusSchema },
  /** Delivers the messages held while paused, or a "continue" turn when there are none. */
  'agent:resume': { request: AgentTicketRequestSchema, response: AgentSessionStatusSchema },
  /** The session's tokens, cost and context window so far (AL-113). */
  'agent:getUsage': { request: AgentTicketRequestSchema, response: AgentUsageSchema },
  /** The MCP servers of the running sessions, for the header pill (AL-108). */
  'agent:getMcpStatus': { request: z.undefined(), response: McpStatusSummarySchema },
  /** Allow once / Allow for this ticket / Deny on a waiting permission request (AL-109). */
  'agent:resolvePermission': { request: ResolvePermissionRequestSchema, response: ResolvePermissionResponseSchema },
  'agent:getPermission': { request: AgentTicketRequestSchema, response: GetPermissionResponseSchema },
} as const satisfies Record<(typeof AGENT_INVOKE_CHANNELS)[number], InvokeContract>;

// Event payloads start as the ticket envelope `{ ticketId, at }` (AL-012); the owning tickets add their fields.

/** Longest activity line or stage summary the agent can report (the card shows one line). */
export const STAGE_TEXT_LIMIT = 300;

/**
 * `agent:stage` (AL-103, design §7 Stage tracking): the ticket moved to another lane, through the
 * agent's `set_stage` call or the session starting (Queued → Planning); or the agent reported its
 * activity with `report_activity`, which drives the card's activity row and progress bar.
 */
export const AgentStageEventSchema = TicketEventEnvelopeSchema.extend({
  /** `stage`: the ticket entered `stage` from `from`. `activity`: only the activity row and progress changed. */
  change: z.enum(['stage', 'activity']),
  /** The ticket's lane after this event. */
  stage: LaneSchema,
  /** The lane it left; null for an activity update. */
  from: LaneSchema.nullable(),
  /** The card's activity row ("Plan approved · implementing the grid"). Always set on an activity update; null on a stage change clears the row. */
  activity: z.string().max(STAGE_TEXT_LIMIT).nullable(),
  /** The card's progress bar, 0 to 1 (0 on a stage change); null leaves it as it was. */
  progress: z.number().min(0).max(1).nullable(),
});
export type AgentStageEvent = z.infer<typeof AgentStageEventSchema>;

/** `agent:subagent`: a sub-agent started, progressed or finished (AL-107). */
export const AgentSubagentEventSchema = TicketEventEnvelopeSchema.extend({});
export type AgentSubagentEvent = z.infer<typeof AgentSubagentEventSchema>;

/**
 * `agent:gate` (AL-104): a stage gate started waiting for the user (the card turns amber with
 * "Needs you · approve plan"), or it ended.
 */
export const AgentGateEventSchema = TicketEventEnvelopeSchema.extend({
  state: z.enum(['waiting', ...GATE_OUTCOMES]),
  stage: PendingGateSchema.shape.stage,
  from: PendingGateSchema.shape.from,
  to: PendingGateSchema.shape.to,
  summary: PendingGateSchema.shape.summary,
  /** The user's note when changes were requested; null otherwise. */
  note: z.string().max(4000).nullable(),
});
export type AgentGateEvent = z.infer<typeof AgentGateEventSchema>;

/** `agent:status`: the session's run state changed (AL-100; paused, AL-105; queued comes with AL-111). */
export const AgentStatusEventSchema = TicketEventEnvelopeSchema.extend({
  state: AgentSessionStateSchema,
  sessionId: AgentSessionStatusSchema.shape.sessionId,
  message: AgentSessionStatusSchema.shape.message,
});
export type AgentStatusEvent = z.infer<typeof AgentStatusEventSchema>;

/** `agent:mcpStatus` (AL-108): the header pill's summary changed. Not about one ticket. */
export const McpStatusEventSchema = EventEnvelopeSchema.extend(McpStatusSummarySchema.shape);
export type McpStatusEvent = z.infer<typeof McpStatusEventSchema>;

/**
 * `agent:permission` (AL-109): a request started waiting (the card turns amber with "Needs you ·
 * allow <tool>"), or it ended: allowed, denied, or cancelled because the turn or session ended.
 * `waiting` is the ticket's oldest waiting request after this change; null when none waits.
 */
export const AgentPermissionEventSchema = TicketEventEnvelopeSchema.extend({
  state: z.enum(['waiting', 'allowed', 'denied', 'cancelled']),
  request: PermissionRequestSchema,
  waiting: PermissionRequestSchema.nullable(),
});
export type AgentPermissionEvent = z.infer<typeof AgentPermissionEventSchema>;

export const agentEventContracts = {
  'agent:output': AgentOutputEventSchema,
  'agent:stage': AgentStageEventSchema,
  'agent:subagent': AgentSubagentEventSchema,
  'agent:gate': AgentGateEventSchema,
  'agent:status': AgentStatusEventSchema,
  'agent:usage': AgentUsageEventSchema,
  'agent:mcpStatus': McpStatusEventSchema,
  'agent:permission': AgentPermissionEventSchema,
} as const satisfies Record<(typeof AGENT_EVENT_CHANNELS)[number], z.ZodType>;
