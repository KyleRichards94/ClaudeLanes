import type { z } from 'zod';
import type { InvokeContract } from '../contract';
import type { SETTINGS_EVENT_CHANNELS, SETTINGS_INVOKE_CHANNELS } from './settings.names';

export const settingsInvokeContracts = {} as const satisfies Record<(typeof SETTINGS_INVOKE_CHANNELS)[number], InvokeContract>;

export const settingsEventContracts = {} as const satisfies Record<(typeof SETTINGS_EVENT_CHANNELS)[number], z.ZodType>;
