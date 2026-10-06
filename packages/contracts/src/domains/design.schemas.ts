import type { z } from 'zod';
import type { InvokeContract } from '../contract';
import type { DESIGN_EVENT_CHANNELS, DESIGN_INVOKE_CHANNELS } from './design.names';

export const designInvokeContracts = {} as const satisfies Record<(typeof DESIGN_INVOKE_CHANNELS)[number], InvokeContract>;

export const designEventContracts = {} as const satisfies Record<(typeof DESIGN_EVENT_CHANNELS)[number], z.ZodType>;
