import type { z } from 'zod';
import type { InvokeContract } from '../contract';
import { EventEnvelopeSchema } from '../events';
import type { CONNECTIONS_EVENT_CHANNELS, CONNECTIONS_INVOKE_CHANNELS } from './connections.names';

export const connectionsInvokeContracts = {} as const satisfies Record<(typeof CONNECTIONS_INVOKE_CHANNELS)[number], InvokeContract>;

/**
 * `connections:changed`: a connection was saved, replaced, removed or re-tested, so the renderer
 * refetches `connections:list` (AL-042). Status only, never a secret (design §8).
 */
export const ConnectionsChangedEventSchema = EventEnvelopeSchema.extend({});
export type ConnectionsChangedEvent = z.infer<typeof ConnectionsChangedEventSchema>;

export const connectionsEventContracts = {
  'connections:changed': ConnectionsChangedEventSchema,
} as const satisfies Record<(typeof CONNECTIONS_EVENT_CHANNELS)[number], z.ZodType>;
