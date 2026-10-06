import type { z } from 'zod';
import type { InvokeContract } from '../contract';
import type { BUILD_EVENT_CHANNELS, BUILD_INVOKE_CHANNELS } from './build.names';

export const buildInvokeContracts = {} as const satisfies Record<(typeof BUILD_INVOKE_CHANNELS)[number], InvokeContract>;

export const buildEventContracts = {} as const satisfies Record<(typeof BUILD_EVENT_CHANNELS)[number], z.ZodType>;
