import { eventContracts, type EventChannel, type EventPayload } from '@agent-lanes/contracts';

export type IpcEventListener<C extends EventChannel> = (payload: EventPayload<C>) => void;

/**
 * Typed subscription to a main → renderer event (design §6 Live events). Every payload is checked
 * against its contract in packages/contracts; one that breaks it is logged and dropped, so a store
 * never sees an unchecked shape and later events still arrive. Returns the unsubscribe function.
 *
 * App code subscribes once per channel through the event hub in `app/` (AL-015), not per component.
 */
export function subscribe<C extends EventChannel>(channel: C, listener: IpcEventListener<C>): () => void {
  const contract = eventContracts[channel];
  return window.agentLanes.on(channel, (raw) => {
    const payload = contract.safeParse(raw);
    if (!payload.success) {
      console.warn(`Dropped an invalid ${channel} event`, payload.error.issues);
      return;
    }
    listener(payload.data as EventPayload<C>);
  });
}
