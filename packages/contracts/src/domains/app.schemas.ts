import { z } from 'zod';
import type { InvokeContract } from '../contract';
import type { APP_EVENT_CHANNELS, APP_INVOKE_CHANNELS } from './app.names';

export const AppInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
  versions: z.object({
    electron: z.string(),
    chrome: z.string(),
    node: z.string(),
  }),
});
export type AppInfo = z.infer<typeof AppInfoSchema>;

export const appInvokeContracts = {
  'app:getInfo': { request: z.undefined(), response: AppInfoSchema },
} as const satisfies Record<(typeof APP_INVOKE_CHANNELS)[number], InvokeContract>;

export const appEventContracts = {} as const satisfies Record<(typeof APP_EVENT_CHANNELS)[number], z.ZodType>;
