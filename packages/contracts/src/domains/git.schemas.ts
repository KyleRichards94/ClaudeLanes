import type { z } from 'zod';
import type { InvokeContract } from '../contract';
import type { GIT_EVENT_CHANNELS, GIT_INVOKE_CHANNELS } from './git.names';

export const gitInvokeContracts = {} as const satisfies Record<(typeof GIT_INVOKE_CHANNELS)[number], InvokeContract>;

export const gitEventContracts = {} as const satisfies Record<(typeof GIT_EVENT_CHANNELS)[number], z.ZodType>;
