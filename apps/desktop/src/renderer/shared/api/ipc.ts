import {
  ResultEnvelopeSchema,
  err,
  invokeContracts,
  ok,
  type InvokeChannel,
  type InvokeRequest,
  type InvokeResponse,
  type Result,
} from '@agent-lanes/contracts';

type InvokeArgs<C extends InvokeChannel> = undefined extends InvokeRequest<C>
  ? [request?: InvokeRequest<C>]
  : [request: InvokeRequest<C>];

/**
 * Typed call into the main process. The envelope and the payload are both validated
 * against packages/contracts, so a renderer never trusts an unchecked shape (design §6).
 */
export async function invoke<C extends InvokeChannel>(channel: C, ...[request]: InvokeArgs<C>): Promise<Result<InvokeResponse<C>>> {
  const raw = await window.agentLanes.invoke(channel, request);

  const envelope = ResultEnvelopeSchema.safeParse(raw);
  if (!envelope.success) return err('INTERNAL', `Malformed reply from ${channel}`);
  if (!envelope.data.ok) return envelope.data;

  const payload = invokeContracts[channel].response.safeParse(envelope.data.data);
  if (!payload.success) return err('INTERNAL', `Unexpected payload from ${channel}`);
  return ok(payload.data as InvokeResponse<C>);
}

/** Unwraps a Result for TanStack Query, which signals failure by throwing. */
export class IpcError extends Error {
  constructor(
    readonly code: string,
    message: string,
    /** The Result's `details`, e.g. MERGE_CONFLICT's conflicted files (AL-086). */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'IpcError';
  }
}

export function unwrap<T>(result: Result<T>): T {
  if (result.ok) return result.data;
  throw new IpcError(result.code, result.message, result.details);
}
