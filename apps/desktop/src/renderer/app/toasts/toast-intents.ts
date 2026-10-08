import type { ToastIntent } from '@agent-lanes/contracts';
import { recoveryFor, type OpenConnectionsOptions, type Recovery, type TicketPageTab } from '@/shared/model';
import type { Route } from '@/shared/routing';

/** What carrying out an error's recovery can reach in the renderer (AL-211). */
export interface RecoveryEnvironment {
  /** Opens the Connections modal, on a saved row when given (AL-046). */
  openConnections(options: OpenConnectionsOptions): void;
  /** Opens the ticket's drill-in on a tab (Build log, Diff). */
  openTicketTab(ticketId: string, tab: TicketPageTab): void;
  /** Reconnects the ticket's lost session. */
  reconnectSession(ticketId: string): void;
  /** "Copy diagnostics" (AL-214). */
  copyDiagnostics(): void;
}

/** What a toast intent can reach in the renderer. Grows with the intents (sessions, AL-048/AL-211). */
export interface ToastIntentContext extends RecoveryEnvironment {
  navigate(route: Route): void;
}

/** Carries out a recovery from the central map (`recoveryFor`, `@/shared/model`). */
export function runRecovery(recovery: Recovery, environment: RecoveryEnvironment): void {
  switch (recovery.kind) {
    case 'open-connections':
      environment.openConnections(recovery.connectionId ? { connectionId: recovery.connectionId } : { tab: 'ado' });
      return;
    case 'reconnect-session':
      environment.reconnectSession(recovery.ticketId);
      return;
    case 'open-ticket-tab':
      environment.openTicketTab(recovery.ticketId, recovery.tab);
      return;
    case 'copy-diagnostics':
      environment.copyDiagnostics();
      return;
  }
}

type IntentOf<T extends ToastIntent['type']> = Extract<ToastIntent, { type: T }>;

/**
 * How the renderer carries out each intent a main-process toast can name (contracts `ToastIntentSchema`).
 * A mapped type, so adding an intent to the contract fails the build until it has an entry here.
 */
const intentHandlers: { readonly [T in ToastIntent['type']]: (intent: IntentOf<T>, context: ToastIntentContext) => void } = {
  navigate: (intent, context) => context.navigate(intent.route),
  // Reconnect: the modal lands on that row with its token field focused (design §8).
  openConnections: (intent, context) => context.openConnections(intent.connectionId ? { connectionId: intent.connectionId } : {}),
  // AL-211: the error code's recovery from the central map.
  recover: (intent, context) => runRecovery(recoveryFor(intent.code, { ticketId: intent.ticketId, connectionId: intent.connectionId }), context),
};

/** Carries out a toast button's intent: opens a page, opens Connections on a row (AL-046), or recovers from an error (AL-211). */
export function runToastIntent(intent: ToastIntent, context: ToastIntentContext): void {
  const handle = intentHandlers[intent.type] as (intent: ToastIntent, context: ToastIntentContext) => void;
  handle(intent, context);
}
