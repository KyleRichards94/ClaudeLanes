import type { z } from 'zod';
import type { InvokeContract } from '../contract';
import type { CONNECTIONS_EVENT_CHANNELS, CONNECTIONS_INVOKE_CHANNELS } from './connections.names';

export const connectionsInvokeContracts = {} as const satisfies Record<(typeof CONNECTIONS_INVOKE_CHANNELS)[number], InvokeContract>;

export const connectionsEventContracts = {} as const satisfies Record<(typeof CONNECTIONS_EVENT_CHANNELS)[number], z.ZodType>;
