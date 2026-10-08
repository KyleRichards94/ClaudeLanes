import { isErrorCode, type ConnectionId, type ErrorCode } from '@agent-lanes/contracts';
import { toast } from './toasts';

/**
 * The central map from error code to the action that recovers from it (AL-211, design §12: "Each
 * code has a defined recovery in the UI"). It is data: the app's ToastHost carries a recovery out
 * (`runRecovery` in `app/toasts`), so a failure raised anywhere, renderer or main (the `recover` toast
 * intent), gets the same button.
 *
 * - `ADO_UNAUTHORIZED` / `ADO_SCOPE_MISSING` → open Connections on that organisation's row;
 * - `SESSION_LOST` → Reconnect the ticket's session;
 * - `BUILD_FAILED` → open the ticket's Build log;
 * - `MERGE_CONFLICT` → the conflict view (the ticket's Diff tab, the files listed in the toast);
 * - `GIT_DIRTY` → the Diff tab on the uncommitted changes;
 * - `VALIDATION` / `INTERNAL` → the details in the toast, and Copy diagnostics.
 */
export type Recovery =
  | { readonly kind: 'open-connections'; readonly label: string; readonly connectionId: ConnectionId | null }
  | { readonly kind: 'reconnect-session'; readonly label: string; readonly ticketId: string }
  | { readonly kind: 'open-ticket-tab'; readonly label: string; readonly ticketId: string; readonly tab: 'build-log' | 'diff' }
  | { readonly kind: 'copy-diagnostics'; readonly label: string };

/** What the error is about, when the caller knows: the ticket, and the connection (`ado:contoso`). */
export interface RecoveryContext {
  readonly ticketId?: string;
  readonly connectionId?: ConnectionId;
}

const COPY_DIAGNOSTICS: Recovery = { kind: 'copy-diagnostics', label: 'Copy diagnostics' };

/** Ticket recoveries need the ticket; without one, the details and Copy diagnostics are what is left. */
function forTicket(context: RecoveryContext, recovery: (ticketId: string) => Recovery): Recovery {
  return context.ticketId ? recovery(context.ticketId) : COPY_DIAGNOSTICS;
}

/** A mapped type over every code, so a new code in contracts fails the build until it has a recovery. */
const RECOVERIES: { readonly [C in ErrorCode]: (context: RecoveryContext) => Recovery } = {
  ADO_UNAUTHORIZED: (context) => ({ kind: 'open-connections', label: 'Reconnect', connectionId: context.connectionId ?? null }),
  ADO_SCOPE_MISSING: (context) => ({ kind: 'open-connections', label: 'Open Connections', connectionId: context.connectionId ?? null }),
  SESSION_LOST: (context) => forTicket(context, (ticketId) => ({ kind: 'reconnect-session', label: 'Reconnect', ticketId })),
  BUILD_FAILED: (context) => forTicket(context, (ticketId) => ({ kind: 'open-ticket-tab', label: 'Open build log', ticketId, tab: 'build-log' })),
  MERGE_CONFLICT: (context) => forTicket(context, (ticketId) => ({ kind: 'open-ticket-tab', label: 'View conflicts', ticketId, tab: 'diff' })),
  GIT_DIRTY: (context) => forTicket(context, (ticketId) => ({ kind: 'open-ticket-tab', label: 'Review changes', ticketId, tab: 'diff' })),
  VALIDATION: () => COPY_DIAGNOSTICS,
  INTERNAL: () => COPY_DIAGNOSTICS,
};

/** The recovery for an error code; an unknown code is treated as INTERNAL. */
export function recoveryFor(code: string, context: RecoveryContext = {}): Recovery {
  return RECOVERIES[isErrorCode(code) ? code : 'INTERNAL'](context);
}

/** Toast titles per code, in the app's plain voice (artboard 6 "Toast · error"). */
export const ERROR_TITLES: { readonly [C in ErrorCode]: string } = {
  ADO_UNAUTHORIZED: 'Azure DevOps needs you to reconnect',
  ADO_SCOPE_MISSING: 'The Azure DevOps token is missing a scope',
  SESSION_LOST: 'The agent session was lost',
  BUILD_FAILED: 'The build failed',
  MERGE_CONFLICT: 'The merge has conflicts',
  GIT_DIRTY: 'The worktree has uncommitted changes',
  VALIDATION: 'That request was refused',
  INTERNAL: 'Something went wrong',
};

/** An error as a failed Result or an `IpcError` carries it. */
export interface RecoverableError {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

const LISTED_FILES = 5;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** The connection an error's details name: ADO results carry the organisation's connection id as `org`. */
function connectionIn(details: unknown): ConnectionId | undefined {
  const org = record(details)?.['org'];
  return typeof org === 'string' && /^ado:[a-z0-9][a-z0-9._-]{0,63}$/.test(org) ? org : undefined;
}

/** "a.cs, b.cs and 3 more", from a GIT_DIRTY or MERGE_CONFLICT result's `files` / `fileCount`. */
export function filesIn(details: unknown): string | undefined {
  const fields = record(details);
  const files = Array.isArray(fields?.['files']) ? fields['files'].filter((file): file is string => typeof file === 'string') : [];
  if (files.length === 0) return undefined;
  const count = typeof fields?.['fileCount'] === 'number' ? Math.max(fields['fileCount'], files.length) : files.length;
  const shown = files.slice(0, LISTED_FILES).join(', ');
  return count > LISTED_FILES ? `${shown} and ${count - LISTED_FILES} more` : shown;
}

/**
 * Shows an error with its recovery as the toast's button (error toasts stay until the user acts).
 * The same error for the same ticket replaces the toast instead of stacking copies. Returns the toast id.
 */
export function showErrorRecovery(error: RecoverableError, context: RecoveryContext = {}): string {
  const code: ErrorCode = isErrorCode(error.code) ? error.code : 'INTERNAL';
  const connectionId = context.connectionId ?? connectionIn(error.details);
  const recovery = recoveryFor(code, { ...context, connectionId });
  const files = code === 'MERGE_CONFLICT' || code === 'GIT_DIRTY' ? filesIn(error.details) : undefined;
  return toast({
    id: `error:${code}:${context.ticketId ?? connectionId ?? ''}`,
    tone: 'error',
    title: ERROR_TITLES[code],
    body: files ? `${error.message} Files: ${files}.` : error.message,
    actions: [
      {
        label: recovery.label,
        intent: {
          type: 'recover',
          code,
          ...(context.ticketId ? { ticketId: context.ticketId } : {}),
          ...(connectionId ? { connectionId } : {}),
        },
      },
    ],
  });
}
