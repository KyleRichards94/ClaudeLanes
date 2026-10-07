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
 * Ticket id format: lowercase ASCII words joined by single dashes, the way AL-082 names worktree
 * folders (`71273`, `nt-20261007-fix-login`). Never a Windows device name (`con`, `nul`, `com1`, …),
 * which no file or folder can use, and never a path: no dots, slashes or spaces.
 */
export const TICKET_ID_PATTERN = /^(?!(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const TICKET_ID_MAX_LENGTH = 64;

/**
 * An Agent Lanes ticket's id, which also names its record file (`<ticketId>.json`, AL-101) and its
 * worktree folder (AL-083): the work item id, or the `nt-<yyyymmdd>-<slug>` name of a ticket
 * without one (AL-082).
 */
export const TicketIdSchema = z.string().min(1).max(TICKET_ID_MAX_LENGTH).regex(TICKET_ID_PATTERN);
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
