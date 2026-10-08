import { z } from 'zod';
import { TicketEventEnvelopeSchema, TicketIdSchema } from '../events';

/**
 * The ticket's design thread (AL-196, R11, D120): the user talks to the design side of the ticket at
 * any stage. In MCP-link mode, or when the webview can't sign in, the thread is in-app and backed by
 * a per-ticket design session (an Agent SDK session with the Claude Design tools), separate from the
 * lead agent's session: nothing said here reaches the implementation agent until a design is shipped
 * (AL-197), and neither side waits on the other.
 */

/** Longest message the user can send, and longest design reply kept (longer replies are cut). */
export const DESIGN_THREAD_TEXT_MAX = 16_000;
/** Messages kept per ticket; older ones are dropped from the saved history. */
export const DESIGN_THREAD_HISTORY_MAX = 200;

export const DESIGN_THREAD_ROLES = ['user', 'design', 'notice'] as const;

/**
 * One entry in the thread: what the user wrote, a design-session reply, or a `notice` from the app
 * (the session could not start, a turn failed, a change was approved or declined).
 */
export const DesignThreadMessageSchema = z.object({
  id: z.string().min(1).max(100),
  role: z.enum(DESIGN_THREAD_ROLES),
  text: z.string().max(DESIGN_THREAD_TEXT_MAX),
  /** When it was written (ms since the epoch). */
  at: z.int().nonnegative(),
  /** A notice about a failure (shown in the danger tone). */
  error: z.boolean().optional(),
});
export type DesignThreadMessage = z.infer<typeof DesignThreadMessageSchema>;

/**
 * A change the design session wants to make to the canvas (D121: writes go through `finalize_plan`),
 * waiting for the user to approve or decline it in the thread.
 */
export const DesignThreadApprovalSchema = z.object({
  id: z.string().min(1).max(100),
  /** The ClaudeDesign operation or Artifact action, e.g. `finalize_plan`. */
  operation: z.string().min(1).max(100),
  /** What it would do, from the tool input, cut to a readable length. */
  summary: z.string().max(4_000),
  at: z.int().nonnegative(),
});
export type DesignThreadApproval = z.infer<typeof DesignThreadApprovalSchema>;

/**
 * `idle`: ready for a message. `replying`: the design session is working on the last message (the user
 * can still send more; they are answered in order). `unavailable`: the Claude login can't reach Claude
 * Design (D119), with `reason`. `no-canvas`: no canvas is linked yet.
 */
export const DESIGN_THREAD_STATUSES = ['idle', 'replying', 'unavailable', 'no-canvas'] as const;
export const DesignThreadStatusSchema = z.enum(DESIGN_THREAD_STATUSES);
export type DesignThreadStatus = z.infer<typeof DesignThreadStatusSchema>;

export const DesignThreadSchema = z.object({
  ticketId: TicketIdSchema,
  status: DesignThreadStatusSchema,
  /** Why the thread is unavailable; null otherwise. */
  reason: z.string().max(1_000).nullable(),
  messages: z.array(DesignThreadMessageSchema).max(DESIGN_THREAD_HISTORY_MAX),
  /** A canvas change waiting for the user; never saved, so it is gone after a restart. */
  approval: DesignThreadApprovalSchema.nullable(),
});
export type DesignThread = z.infer<typeof DesignThreadSchema>;

/** `design:getThread`: the ticket's thread as saved, plus what its live session is doing. */
export const DesignThreadRequestSchema = z.object({ ticketId: TicketIdSchema });
export type DesignThreadRequest = z.infer<typeof DesignThreadRequestSchema>;

/** `design:sendThreadMessage`: a message to the design side. Answered through `design:thread` events. */
export const SendDesignThreadMessageRequestSchema = z.object({
  ticketId: TicketIdSchema,
  text: z.string().trim().min(1).max(DESIGN_THREAD_TEXT_MAX),
});
export type SendDesignThreadMessageRequest = z.infer<typeof SendDesignThreadMessageRequestSchema>;

/** `design:answerThreadApproval`: the user's answer to the pending canvas change. */
export const AnswerDesignThreadApprovalRequestSchema = z.object({
  ticketId: TicketIdSchema,
  approvalId: z.string().min(1).max(100),
  approve: z.boolean(),
});
export type AnswerDesignThreadApprovalRequest = z.infer<typeof AnswerDesignThreadApprovalRequestSchema>;

/** `design:thread`: the ticket's thread changed (a message, a reply, a status or a pending approval). */
export const DesignThreadEventSchema = TicketEventEnvelopeSchema.extend({
  thread: DesignThreadSchema,
});
export type DesignThreadEvent = z.infer<typeof DesignThreadEventSchema>;
