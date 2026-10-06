import type { z } from 'zod';
import type { InvokeContract } from '../contract';
import type { TICKETS_EVENT_CHANNELS, TICKETS_INVOKE_CHANNELS } from './tickets.names';

export const ticketsInvokeContracts = {} as const satisfies Record<(typeof TICKETS_INVOKE_CHANNELS)[number], InvokeContract>;

export const ticketsEventContracts = {} as const satisfies Record<(typeof TICKETS_EVENT_CHANNELS)[number], z.ZodType>;
