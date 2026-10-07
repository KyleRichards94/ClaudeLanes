import type { ToastIntent } from '@agent-lanes/contracts';
import type { Route } from '@/shared/routing';

/** What a toast intent can reach in the renderer. Grows with the intents (Connections modal, sessions). */
export interface ToastIntentContext {
  navigate(route: Route): void;
}

type IntentOf<T extends ToastIntent['type']> = Extract<ToastIntent, { type: T }>;

/**
 * How the renderer carries out each intent a main-process toast can name (contracts `ToastIntentSchema`).
 * A mapped type, so adding an intent to the contract fails the build until it has an entry here.
 */
const intentHandlers: { readonly [T in ToastIntent['type']]: (intent: IntentOf<T>, context: ToastIntentContext) => void } = {
  navigate: (intent, context) => context.navigate(intent.route),
};

/** Carries out a toast button's intent: opens a page, and later reconnects or opens Connections (AL-048, AL-211). */
export function runToastIntent(intent: ToastIntent, context: ToastIntentContext): void {
  const handle = intentHandlers[intent.type] as (intent: ToastIntent, context: ToastIntentContext) => void;
  handle(intent, context);
}
