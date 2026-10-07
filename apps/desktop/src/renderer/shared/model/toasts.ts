import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { TOAST_MAX_ACTIONS, type ToastEvent, type ToastIntent, type ToastTone } from '@agent-lanes/contracts';
import type { EventHandlers } from '@/shared/api';

/** How long an info toast stays on screen before it closes itself (AL-030). Other tones wait for the user. */
export const INFO_TOAST_DURATION_MS = 5_000;

/**
 * A toast button. Renderer code passes a callback; a toast raised by the main process names an
 * intent instead (it can't send a function over IPC), which the app's ToastHost carries out.
 */
export type ToastActionInput =
  | { readonly label: string; readonly onPress: () => void }
  | { readonly label: string; readonly intent: ToastIntent };

export interface ToastInput {
  /**
   * Names the notice, e.g. `ado-unauthorized:contoso`. Raising a toast with the id of one still
   * showing replaces that one in place instead of stacking a copy. Generated when left out.
   */
  id?: string;
  tone: ToastTone;
  /** What happened, in a few words. */
  title: string;
  /** One or two sentences of detail. */
  body?: string;
  /** Up to two buttons before Dismiss; the first is the primary one. Pressing one runs it and closes the toast. */
  actions?: readonly ToastActionInput[];
}

/** A toast on screen or waiting for room in the stack. */
export interface ToastEntry {
  readonly id: string;
  /** Goes up each time a toast with this id is raised again, so the host restarts its timer. */
  readonly revision: number;
  readonly tone: ToastTone;
  readonly title: string;
  readonly body?: string;
  readonly actions: readonly ToastActionInput[];
}

export interface ToastState {
  /** Oldest first. */
  readonly toasts: readonly ToastEntry[];
}

const toastStore = createStore<ToastState>()(() => ({ toasts: [] }));
let generatedIds = 0;

/**
 * Shows a toast (design §11 Toast, artboard 6) and returns its id. Info toasts close themselves
 * after `INFO_TOAST_DURATION_MS`; success, warning and error toasts stay until the user presses one
 * of their buttons. Callable from any layer; the app's ToastHost renders the stack.
 *
 * @example toast({ tone: 'error', title: 'MCP bridge lost the session', body: '…', actions: [{ label: 'Reconnect', onPress }] })
 */
export function toast({ id, tone, title, body, actions = [] }: ToastInput): string {
  if (actions.length > TOAST_MAX_ACTIONS) {
    console.warn(`A toast shows at most ${TOAST_MAX_ACTIONS} actions; dropped ${actions.length - TOAST_MAX_ACTIONS} from "${title}"`);
  }
  const toastId = id ?? `toast-${++generatedIds}`;
  const fields = { tone, title, body, actions: actions.slice(0, TOAST_MAX_ACTIONS) };

  toastStore.setState(({ toasts }) => {
    const index = toasts.findIndex((entry) => entry.id === toastId);
    if (index === -1) return { toasts: [...toasts, { id: toastId, revision: 0, ...fields }] };
    const replaced = toasts[index];
    return { toasts: toasts.with(index, { id: toastId, revision: (replaced?.revision ?? 0) + 1, ...fields }) };
  });
  return toastId;
}

/** Closes a toast. Does nothing if it has already gone. */
export function dismissToast(id: string): void {
  toastStore.setState(({ toasts }) =>
    toasts.some((entry) => entry.id === id) ? { toasts: toasts.filter((entry) => entry.id !== id) } : { toasts },
  );
}

/** Closes every toast (tests, and a later "clear all"). */
export function clearToasts(): void {
  toastStore.setState({ toasts: [] });
}

/** The current toasts, oldest first, for non-React callers and tests. */
export function getToasts(): readonly ToastEntry[] {
  return toastStore.getState().toasts;
}

const selectToasts = (state: ToastState) => state.toasts;

/** The current toasts, oldest first; re-renders when they change. */
export function useToasts(): readonly ToastEntry[] {
  return useStore(toastStore, selectToasts);
}

/** Whether a toast closes itself: info toasts only (AL-030). Errors stay until acted on. */
export function autoDismisses(entry: Pick<ToastEntry, 'tone'>): boolean {
  return entry.tone === 'info';
}

/** A `toast` event from the main process as toast input; its actions keep their intents. */
export function toastFromEvent({ id, tone, title, body, actions = [] }: ToastEvent): ToastInput {
  return { id, tone, title, body, actions: actions.map(({ label, intent }) => ({ label, intent })) };
}

/**
 * Shows each `toast` event from the main process (AL-012 channel). Registered with the app's event
 * hub in `app/entrypoint/event-routes.ts`.
 */
export const toastEventHandlers: EventHandlers = {
  toast: (event) => {
    toast(toastFromEvent(event));
  },
};
