import type { z } from 'zod';
import type { InvokeContract } from '../contract';
import { TicketEventEnvelopeSchema } from '../events';
import type { BUILD_EVENT_CHANNELS, BUILD_INVOKE_CHANNELS } from './build.names';

export const buildInvokeContracts = {} as const satisfies Record<(typeof BUILD_INVOKE_CHANNELS)[number], InvokeContract>;

// Event payloads start as the ticket envelope `{ ticketId, at }` (AL-012); the owning tickets add their fields.

/** `build:log`: a batch of output lines from the ticket's build job (AL-132). */
export const BuildLogEventSchema = TicketEventEnvelopeSchema.extend({});
export type BuildLogEvent = z.infer<typeof BuildLogEventSchema>;

/** `run:status`: the ticket's run job started, found its URL, or stopped (AL-133, AL-134). */
export const RunStatusEventSchema = TicketEventEnvelopeSchema.extend({});
export type RunStatusEvent = z.infer<typeof RunStatusEventSchema>;

export const buildEventContracts = {
  'build:log': BuildLogEventSchema,
  'run:status': RunStatusEventSchema,
} as const satisfies Record<(typeof BUILD_EVENT_CHANNELS)[number], z.ZodType>;
