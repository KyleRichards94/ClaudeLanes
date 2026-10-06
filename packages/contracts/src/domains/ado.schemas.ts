import type { z } from 'zod';
import type { InvokeContract } from '../contract';
import type { ADO_EVENT_CHANNELS, ADO_INVOKE_CHANNELS } from './ado.names';

export const adoInvokeContracts = {} as const satisfies Record<(typeof ADO_INVOKE_CHANNELS)[number], InvokeContract>;

export const adoEventContracts = {} as const satisfies Record<(typeof ADO_EVENT_CHANNELS)[number], z.ZodType>;
