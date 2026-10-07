import { z } from 'zod';
import type { InvokeContract } from './contract';
import { adoEventContracts, adoInvokeContracts } from './domains/ado.schemas';
import { agentEventContracts, agentInvokeContracts } from './domains/agent.schemas';
import { appEventContracts, appInvokeContracts } from './domains/app.schemas';
import { buildEventContracts, buildInvokeContracts } from './domains/build.schemas';
import { connectionsEventContracts, connectionsInvokeContracts } from './domains/connections.schemas';
import { designEventContracts, designInvokeContracts } from './domains/design.schemas';
import { gitEventContracts, gitInvokeContracts } from './domains/git.schemas';
import { reposEventContracts, reposInvokeContracts } from './domains/repos.schemas';
import { settingsEventContracts, settingsInvokeContracts } from './domains/settings.schemas';
import { ticketsEventContracts, ticketsInvokeContracts } from './domains/tickets.schemas';
import type { EventChannel, InvokeChannel } from './names';
import { ERROR_CODES } from './result';

/** Every invoke contract, by channel. Domains own their entries in `domains/<domain>.schemas.ts`. */
export const invokeContracts = {
  ...appInvokeContracts,
  ...settingsInvokeContracts,
  ...connectionsInvokeContracts,
  ...adoInvokeContracts,
  ...reposInvokeContracts,
  ...gitInvokeContracts,
  ...ticketsInvokeContracts,
  ...agentInvokeContracts,
  ...buildInvokeContracts,
  ...designInvokeContracts,
} as const satisfies Record<InvokeChannel, InvokeContract>;

/** Every event payload schema, by channel. */
export const eventContracts = {
  ...appEventContracts,
  ...settingsEventContracts,
  ...connectionsEventContracts,
  ...adoEventContracts,
  ...reposEventContracts,
  ...gitEventContracts,
  ...ticketsEventContracts,
  ...agentEventContracts,
  ...buildEventContracts,
  ...designEventContracts,
} as const satisfies Record<EventChannel, z.ZodType>;

export type InvokeRequest<C extends InvokeChannel> = z.input<(typeof invokeContracts)[C]['request']>;
export type InvokeResponse<C extends InvokeChannel> = z.output<(typeof invokeContracts)[C]['response']>;
export type EventPayload<C extends EventChannel> = z.output<(typeof eventContracts)[C]>;
/** What main passes to `emit`: the payload before defaults (such as the envelope's `at`) are filled in. */
export type EventInput<C extends EventChannel> = z.input<(typeof eventContracts)[C]>;

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
