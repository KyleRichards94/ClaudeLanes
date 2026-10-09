import { z } from 'zod';
import type { InvokeContract } from '../contract';
import { EventEnvelopeSchema, TicketEventEnvelopeSchema, TicketIdSchema } from '../events';
import { EffortSchema, GateSchema, LaneSchema, ModelSchema, StageSchema, type Model } from '../vocabulary';
import { StageGatesSchema } from './settings.schemas';
import { AgentUsageEventSchema, AgentUsageSchema } from './agent.usage';
import { AgentSessionStateSchema, AgentSessionStatusSchema } from './agent.status';
import { LaunchFromAdoRequestSchema, LaunchFromAdoResponseSchema, UndoLaunchRequestSchema, UndoLaunchResponseSchema } from './agent.launch-from-ado';
import { PlanLimitsEventSchema, PlanLimitsSchema } from './agent.plan-limits';
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

// The session status (`AGENT_SESSION_STATES`, `AgentSessionStatusSchema`) lives in `agent.status.ts`, so the
// tickets domain's launch (AL-165) and launch from the team board (AL-236) can use it without an import cycle.

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

/**
 * Where a user message came from (AL-251): typed in the composer, a skill chip (`/code-review`), the
 * launch's job description, the brief a new agent was handed (AL-263), or a turn the app sent on its
 * own, which the Output tab leaves out.
 */
export const USER_MESSAGE_SOURCES = ['composer', 'skill', 'launch', 'hand-over', 'app'] as const;
export const UserMessageSourceSchema = z.enum(USER_MESSAGE_SOURCES);
export type UserMessageSource = z.infer<typeof UserMessageSourceSchema>;

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
 * - `user`: what the user sent: a composer message, a skill command, the launch job or a hand-over
 *   brief (AL-251); the app's own turns ("Continue where you left off.") are not shown;
 * - `result`: a turn ended: usage, cost and duration;
 * - `compact`: the context was compacted (AL-257), by the agent or the user, from `preTokens` to `postTokens`.
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
    /**
     * The call's full input for the expanded row (AL-256): the whole command, the pattern and path,
     * a sub-agent's prompt, or the input as JSON for other tools. Clipped; null when there is nothing beyond `detail`.
     */
    input: z.string().max(OUTPUT_TEXT_LIMIT).nullable().optional(),
    /** An Edit or Write's text before and after, for the inline diff (AL-256); null for other tools. */
    edit: z.object({ before: z.string().max(OUTPUT_TEXT_LIMIT), after: z.string().max(OUTPUT_TEXT_LIMIT) }).nullable().optional(),
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
    /** What the tool returned, or its error, for the expanded row (AL-256); clipped. Absent on older buffers. */
    output: z.string().max(OUTPUT_TEXT_LIMIT).optional(),
  }),
  OutputItemBase.extend({
    kind: z.literal('system'),
    text: OutputLineSchema,
  }),
  OutputItemBase.extend({
    kind: z.literal('compact'),
    trigger: z.enum(['auto', 'manual']),
    preTokens: z.int().nonnegative(),
    postTokens: z.int().nonnegative().nullable(),
  }),
  OutputItemBase.extend({
    kind: z.literal('user'),
    /** The SDK message's uuid: what Rewind to here and Fork from here take (AL-265); null for history without one. */
    messageId: z.string().max(200).nullable(),
    text: z.string().max(OUTPUT_TEXT_LIMIT),
    /** `now` when sent with Steer now (D11); null when unknown. */
    priority: z.enum(['now', 'next']).nullable(),
    source: UserMessageSourceSchema,
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

/** `agent:stop` (AL-253): whether a live session was closed, and the ticket's status after. */
export const StopSessionResponseSchema = z.object({ stopped: z.boolean(), status: AgentSessionStatusSchema });
export type StopSessionResponse = z.infer<typeof StopSessionResponseSchema>;

/** Why a session ended at the user's request, shown on the status pill (AL-252, AL-253). */
export const SESSION_ENDED_BY_USER_MESSAGE = 'You ended this session. The worktree and branch are intact.';

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

// ── Live model and effort change (AL-106, R7, design §7, artboard 6 "Model switching") ─────────────

/** A model and effort pair, as the card shows it ("Sonnet · High"). */
export const ModelEffortSchema = z.object({ model: ModelSchema, effort: EffortSchema });
export type ModelEffort = z.infer<typeof ModelEffortSchema>;

/**
 * What a ticket's agent runs with now, and the change waiting for it. A change made while the session
 * runs applies from its next turn (R7): until the next assistant message reports the new model (or the
 * next turn starts) `pending` holds it and the card shows "Opus → Sonnet · High" with "Switching ·
 * applies next turn"; then `model`/`effort` take it and `pending` clears. Without a live session a
 * change applies at once (the next start uses the ticket record, which is saved on every change).
 */
export const AgentModelStateSchema = z.object({
  ticketId: TicketIdSchema,
  model: ModelSchema,
  effort: EffortSchema,
  pending: ModelEffortSchema.nullable(),
});
export type AgentModelState = z.infer<typeof AgentModelStateSchema>;

/** `agent:setModel`: switch the model (Opus / Sonnet / Haiku) from the next turn; saved on the ticket. */
export const SetModelRequestSchema = z.strictObject({ ticketId: TicketIdSchema, model: ModelSchema });
export type SetModelRequest = z.infer<typeof SetModelRequestSchema>;

/** `agent:setEffort`: change the effort (Low … Max) from the next turn; saved on the ticket. */
export const SetEffortRequestSchema = z.strictObject({ ticketId: TicketIdSchema, effort: EffortSchema });
export type SetEffortRequest = z.infer<typeof SetEffortRequestSchema>;

/** The user turn "Apply model now" sends after interrupting, so the agent carries on with the new model. */
export const APPLY_MODEL_NOW_MESSAGE = 'Continue where you left off.';

// ── Sub-agent tracking (AL-107, artboard 3 Sub-agents, design §6 `agent:subagent`) ────────────────

/** Longest description or activity line sent for a sub-agent (the panel shows one line). */
export const SUBAGENT_TEXT_LIMIT = 300;

/** Sub-agent states on the panel's pills (artboard 3): Queued / Running / Done / Failed. */
export const SUBAGENT_STATUSES = ['queued', 'running', 'done', 'failed'] as const;
export const SubagentStatusSchema = z.enum(SUBAGENT_STATUSES);
export type SubagentStatus = z.infer<typeof SubagentStatusSchema>;

/** How many sub-agents are in each state ("2 running · 1 done · 1 queued"). */
export const SubagentCountsSchema = z.object({
  queued: z.int().nonnegative(),
  running: z.int().nonnegative(),
  done: z.int().nonnegative(),
  failed: z.int().nonnegative(),
});
export type SubagentCounts = z.infer<typeof SubagentCountsSchema>;

/**
 * One sub-agent in the ticket's tree, built from the lead agent's Agent/Task tool uses
 * (`parent_tool_use_id` nests them), the SDK's task_started / task_updated / task_progress /
 * task_notification messages and the SubagentStart / SubagentStop hooks.
 */
export const SubagentNodeSchema = z.object({
  /** The Agent/Task tool use that spawned it (or the SDK task id for a task with no tool use seen). */
  id: z.string().min(1).max(200),
  /** The SDK task id once the task started; null while queued. */
  taskId: z.string().max(200).nullable(),
  /** The sub-agent that spawned this one; null for one the lead agent spawned. */
  parentId: z.string().max(200).nullable(),
  /** "explore", "razor-writer": the agent type, else the tool use's name. */
  name: z.string().min(1).max(200),
  agentType: z.string().max(200).nullable(),
  /** What it was asked to do ("Mapped 4 child modals…" while running comes in `activity`). */
  description: z.string().max(SUBAGENT_TEXT_LIMIT),
  /** The model it runs on when known; null when it inherits the lead agent's. */
  model: ModelSchema.nullable(),
  effort: EffortSchema.nullable(),
  status: SubagentStatusSchema,
  /** The one-line activity: the latest progress summary, or its result when finished. */
  activity: z.string().max(SUBAGENT_TEXT_LIMIT).nullable(),
  /** Tokens it has used, when the SDK reported them. */
  tokens: z.int().nonnegative().nullable(),
  /** Its sub-branch (AL-084) for a writer; null for one that has none (read-only, or not created yet). */
  branch: z.string().max(255).nullable(),
  /** A read-only agent type (explore, reviewer) that shares the ticket worktree. */
  readOnly: z.boolean(),
  startedAt: z.int().nonnegative(),
  endedAt: z.int().nonnegative().nullable(),
});
export type SubagentNode = z.infer<typeof SubagentNodeSchema>;

/** Most sub-agents kept per ticket; the oldest finished ones are dropped first. */
export const SUBAGENT_TREE_LIMIT = 200;

/** `agent:getSubagents`: the ticket's tree, for a drill-in opened mid-run. */
export const AgentSubagentsSchema = z.object({
  ticketId: TicketIdSchema,
  /** The lead agent's tokens this app run ("212k tokens"). */
  leadTokens: z.int().nonnegative(),
  /** Oldest first. */
  nodes: z.array(SubagentNodeSchema).max(SUBAGENT_TREE_LIMIT),
  counts: SubagentCountsSchema,
});
export type AgentSubagents = z.infer<typeof AgentSubagentsSchema>;

/** The Sub-agents panel heading's counts: "2 running · 1 done · 1 queued" (zeros left out). */
export function subagentCountsLabel(counts: SubagentCounts): string {
  const parts = (['running', 'done', 'queued', 'failed'] as const).filter((status) => counts[status] > 0).map((status) => `${counts[status]} ${status}`);
  return parts.length > 0 ? parts.join(' · ') : 'none yet';
}

/**
 * `agent:subagent` (AL-107): a sub-agent was spawned or started (`started`), progressed (`updated`) or
 * finished (`finished`); carries the node as it is now and the ticket's counts.
 */
export const AgentSubagentEventSchema = TicketEventEnvelopeSchema.extend({
  change: z.enum(['started', 'updated', 'finished']),
  node: SubagentNodeSchema,
  counts: SubagentCountsSchema,
});
export type AgentSubagentEvent = z.infer<typeof AgentSubagentEventSchema>;

export const agentInvokeContracts = {
  'agent:getStatus': { request: AgentTicketRequestSchema, response: AgentSessionStatusSchema },
  'agent:getTranscript': { request: AgentTicketRequestSchema, response: AgentTranscriptSchema },
  'agent:resolveGate': { request: ResolveGateRequestSchema, response: ResolveGateResponseSchema },
  'agent:setGate': { request: SetGateRequestSchema, response: SetGateResponseSchema },
  'agent:getGate': { request: AgentTicketRequestSchema, response: GetGateResponseSchema },
  'agent:send': { request: SendMessageRequestSchema, response: SendMessageResponseSchema },
  'agent:setModel': { request: SetModelRequestSchema, response: AgentModelStateSchema },
  'agent:setEffort': { request: SetEffortRequestSchema, response: AgentModelStateSchema },
  /** "Apply model now": interrupts the turn, then a "continue" turn starts with the new model and effort. */
  'agent:applyModelNow': { request: AgentTicketRequestSchema, response: AgentModelStateSchema },
  /** For a renderer that reloads while a switch is pending. */
  'agent:getModel': { request: AgentTicketRequestSchema, response: AgentModelStateSchema },
  /** The ticket's sub-agent tree and counts, for a drill-in opened mid-run (AL-107). */
  'agent:getSubagents': { request: AgentTicketRequestSchema, response: AgentSubagentsSchema },
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
  /** Reconnect (AL-110): resumes a lost session from its saved session id in the same worktree. */
  'agent:reconnect': { request: AgentTicketRequestSchema, response: AgentSessionStatusSchema },
  /** "Start now" (AL-111): starts a queued ticket at once, over its repo's concurrency cap. */
  'agent:startNow': { request: AgentTicketRequestSchema, response: AgentSessionStatusSchema },
  /** Launch from the team board (AL-236): recheck, the one ADO change, worktree, ticket and session; rolls back on failure. */
  'agent:launchFromAdo': { request: LaunchFromAdoRequestSchema, response: LaunchFromAdoResponseSchema },
  /** Undo (AL-237): within 10 s and before the first turn ends, puts the item back and removes the agent, worktree and ticket. */
  'agent:undoLaunch': { request: UndoLaunchRequestSchema, response: UndoLaunchResponseSchema },
  /** Stop turn (AL-253): ends the running turn at its next tool boundary; the session stays live for the next message. */
  'agent:interrupt': { request: AgentTicketRequestSchema, response: AgentSessionStatusSchema },
  /** End session (AL-253): closes the session and its `claude` process; the worktree and branch stay. `stopped` false when none was live. */
  'agent:stop': { request: AgentTicketRequestSchema, response: StopSessionResponseSchema },
  /** Compact (AL-257): asks the live session to compact its context now (`/compact` as the next turn). */
  'agent:compact': { request: AgentTicketRequestSchema, response: SendMessageResponseSchema },
  /** The plan's 5-hour and 7-day windows as the sessions last reported them (AL-258). */
  'agent:getPlanLimits': { request: z.undefined(), response: PlanLimitsSchema },
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

/**
 * `agent:model` (AL-106): a model or effort change was asked for (`pending` set: the card shows
 * "Opus → Sonnet · High" and "Switching · applies next turn"), or it now applies (`pending` null).
 */
export const AgentModelEventSchema = TicketEventEnvelopeSchema.extend({
  model: ModelSchema,
  effort: EffortSchema,
  pending: ModelEffortSchema.nullable(),
});
export type AgentModelEvent = z.infer<typeof AgentModelEventSchema>;

export const agentEventContracts = {
  'agent:output': AgentOutputEventSchema,
  'agent:stage': AgentStageEventSchema,
  'agent:subagent': AgentSubagentEventSchema,
  'agent:gate': AgentGateEventSchema,
  'agent:status': AgentStatusEventSchema,
  'agent:usage': AgentUsageEventSchema,
  'agent:mcpStatus': McpStatusEventSchema,
  'agent:permission': AgentPermissionEventSchema,
  'agent:model': AgentModelEventSchema,
  'agent:planLimits': PlanLimitsEventSchema,
} as const satisfies Record<(typeof AGENT_EVENT_CHANNELS)[number], z.ZodType>;
