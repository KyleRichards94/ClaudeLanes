import type { z } from 'zod';
import type { InvokeContract } from '../contract';
import type { AGENT_EVENT_CHANNELS, AGENT_INVOKE_CHANNELS } from './agent.names';

export const agentInvokeContracts = {} as const satisfies Record<(typeof AGENT_INVOKE_CHANNELS)[number], InvokeContract>;

export const agentEventContracts = {} as const satisfies Record<(typeof AGENT_EVENT_CHANNELS)[number], z.ZodType>;
