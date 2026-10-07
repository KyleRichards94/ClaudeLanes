import { z } from 'zod';

/**
 * Envelope every main → renderer event starts from (AL-012, design §6 Live events).
 *
 * Domains build each event's payload by extending one of these in `domains/<domain>.schemas.ts`.
 * Objects strip keys they don't declare, and main sends the parsed payload, so only fields named
 * in a contract ever cross IPC: a token passed to `emit` by mistake is dropped, never sent.
 */

/**
 * When main raised the event, in milliseconds since the Unix epoch (`Date.now()`).
 * Optional on input: `emit` stamps the current time when the caller doesn't pass one.
 */
export const EventTimeSchema = z
  .number()
  .int()
  .nonnegative()
  .default(() => Date.now());

/**
 * An Agent Lanes ticket's id, which also names its record file (AL-101) and worktree folder (AL-083).
 * Kept to a non-empty string until those tickets pin the format (AL-082 naming).
 */
export const TicketIdSchema = z.string().min(1);
export type TicketId = z.infer<typeof TicketIdSchema>;

/** Events that are not about one ticket (`toast`, `connections:changed`). */
export const EventEnvelopeSchema = z.object({
  at: EventTimeSchema,
});
export type EventEnvelope = z.infer<typeof EventEnvelopeSchema>;

/** Events about one ticket; the app's event hub routes them to that ticket's store entry (AL-015). */
export const TicketEventEnvelopeSchema = EventEnvelopeSchema.extend({
  ticketId: TicketIdSchema,
});
export type TicketEventEnvelope = z.infer<typeof TicketEventEnvelopeSchema>;
