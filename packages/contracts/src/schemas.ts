import { z } from 'zod';
import type { EventChannel, InvokeChannel } from './names';
import { ERROR_CODES } from './result';

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

interface InvokeContract {
  request: z.ZodType;
  response: z.ZodType;
}

export const invokeContracts = {
  'app:getInfo': { request: z.undefined(), response: AppInfoSchema },
} as const satisfies Record<InvokeChannel, InvokeContract>;

export const eventContracts = {} as const satisfies Record<EventChannel, z.ZodType>;

export type InvokeRequest<C extends InvokeChannel> = z.input<(typeof invokeContracts)[C]['request']>;
export type InvokeResponse<C extends InvokeChannel> = z.output<(typeof invokeContracts)[C]['response']>;
export type EventPayload<C extends EventChannel> = z.output<(typeof eventContracts)[C]>;

/** Validates the Result envelope that comes back over IPC before the payload is parsed. */
export const ResultEnvelopeSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }),
  z.object({
    ok: z.literal(false),
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
]);
