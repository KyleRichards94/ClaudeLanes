import { z } from 'zod';
import type { InvokeContract } from '../contract';
import { EventEnvelopeSchema } from '../events';
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

/** How a toast looks; error toasts wait for the user, info toasts dismiss themselves (AL-030). */
export const ToastToneSchema = z.enum(['info', 'success', 'warning', 'error']);
export type ToastTone = z.infer<typeof ToastToneSchema>;

/**
 * `toast`: a notice raised by the main process, e.g. a connection that needs reconnecting (design §8).
 * Not tied to one ticket, so it carries only `at` from the envelope. AL-030 adds actions.
 */
export const ToastEventSchema = EventEnvelopeSchema.extend({
  tone: ToastToneSchema,
  title: z.string().min(1),
  body: z.string().optional(),
});
export type ToastEvent = z.infer<typeof ToastEventSchema>;

export const appEventContracts = {
  toast: ToastEventSchema,
} as const satisfies Record<(typeof APP_EVENT_CHANNELS)[number], z.ZodType>;
