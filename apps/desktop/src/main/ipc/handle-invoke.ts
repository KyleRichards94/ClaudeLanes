import {
  err,
  invokeContracts,
  ok,
  type InvokeChannel,
  type InvokeRequest,
  type InvokeResponse,
  type Result,
} from '@agent-lanes/contracts';
import type { Logger } from '../logging';

export type InvokeHandler<C extends InvokeChannel> = (
  request: InvokeRequest<C>,
) => Promise<Result<InvokeResponse<C>>> | Result<InvokeResponse<C>>;

/** Handlers for a subset of channels, e.g. one domain's (`HandlersFor<'ado:listSprints' | …>`). */
export type HandlersFor<C extends InvokeChannel> = { [K in C]: InvokeHandler<K> };

/** One handler per channel; the mapped type fails the build when a channel has none. */
export type InvokeHandlers = HandlersFor<InvokeChannel>;

/** Where refused requests and failing handlers are reported (the app log, AL-214). */
export type InvokeLog = Pick<Logger, 'warn' | 'error'>;

/**
 * Validates the request against its contract, runs the handler, validates the response,
 * and turns any throw into an INTERNAL error so only Result values cross IPC (design §12).
 * Refused requests, invalid responses and throws are also written to `log`, throws with their stack.
 */
export async function handleInvoke<C extends InvokeChannel>(
  channel: C,
  raw: unknown,
  handler: InvokeHandler<C>,
  log?: InvokeLog,
): Promise<Result<InvokeResponse<C>>> {
  const contract = invokeContracts[channel];
  const request = contract.request.safeParse(raw);
  if (!request.success) {
    log?.warn(`Refused ${channel}: the request breaks its contract`, request.error.issues);
    return err('VALIDATION', `Invalid request for ${channel}`, request.error.issues);
  }

  try {
    const result = await handler(request.data as InvokeRequest<C>);
    if (!result.ok) return result;

    const response = contract.response.safeParse(result.data);
    if (!response.success) {
      log?.error(`Handler for ${channel} returned an invalid response`, response.error.issues);
      return err('INTERNAL', `Handler for ${channel} returned an invalid response`, response.error.issues);
    }
    return ok(response.data as InvokeResponse<C>);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    log?.error(`${channel} failed: ${message}`, cause);
    return err('INTERNAL', `${channel} failed: ${message}`);
  }
}
