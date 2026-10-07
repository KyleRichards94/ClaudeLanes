import type { z } from 'zod';
import type { InvokeContract } from '../contract';
import { TicketEventEnvelopeSchema } from '../events';
import type { DESIGN_EVENT_CHANNELS, DESIGN_INVOKE_CHANNELS } from './design.names';

export const designInvokeContracts = {} as const satisfies Record<(typeof DESIGN_INVOKE_CHANNELS)[number], InvokeContract>;

/**
 * `design:spec`: a design spec was shipped to the ticket's agent or acknowledged by it (AL-197, AL-198).
 * Starts as the ticket envelope `{ ticketId, at }` (AL-012); those tickets add their fields.
 */
export const DesignSpecEventSchema = TicketEventEnvelopeSchema.extend({});
export type DesignSpecEvent = z.infer<typeof DesignSpecEventSchema>;

export const designEventContracts = {
  'design:spec': DesignSpecEventSchema,
} as const satisfies Record<(typeof DESIGN_EVENT_CHANNELS)[number], z.ZodType>;
