import { z } from 'zod';
import { TicketIdSchema } from '../events';

/**
 * A ticket's session status (AL-100), in a file of its own so the tickets domain's launch (AL-165) and
 * the agent domain's launch from the team board (AL-236) can both return it without an import cycle.
 * `agent.schemas.ts` uses it for the `agent:*` channels.
 */

/**
 * Where a ticket's agent session is:
 * - `none`: no session has run for the ticket since the app started;
 * - `starting`: `claude` is being started;
 * - `running`: a turn is in progress;
 * - `idle`: the turn ended and the session waits for the next user turn;
 * - `paused`: the user paused it (AL-105): the turn was interrupted and new messages wait for Resume;
 * - `stopped`: the app closed the session (its process is gone);
 * - `lost`: the session ended without being asked to (crash, process exit); AL-110 recovers it;
 * - `queued`: its repo is at the concurrency cap; it starts when a slot frees, or on "Start now" (AL-111).
 */
export const AGENT_SESSION_STATES = ['none', 'starting', 'running', 'idle', 'paused', 'stopped', 'lost', 'queued'] as const;
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
