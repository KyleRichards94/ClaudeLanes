import type { z } from 'zod';
import type { InvokeContract } from '../contract';
import type { REPOS_EVENT_CHANNELS, REPOS_INVOKE_CHANNELS } from './repos.names';

export const reposInvokeContracts = {} as const satisfies Record<(typeof REPOS_INVOKE_CHANNELS)[number], InvokeContract>;

export const reposEventContracts = {} as const satisfies Record<(typeof REPOS_EVENT_CHANNELS)[number], z.ZodType>;
