import { z } from 'zod';
import type { InvokeContract } from '../contract';
import { EventEnvelopeSchema, TicketIdSchema } from '../events';
import type { APP_EVENT_CHANNELS, APP_INVOKE_CHANNELS } from './app.names';
import { ConnectionIdSchema } from './connections.schemas';

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

/** Caps on what the renderer may send to the log in one report; the renderer truncates to them (AL-214). */
export const RENDERER_ERROR_LIMITS = {
  name: 200,
  message: 4_000,
  stack: 20_000,
  componentStack: 20_000,
  boundary: 200,
} as const;

/**
 * `app:logError`: an error the renderer caught (an error boundary, `window.onerror`, an unhandled
 * rejection), written to the main-process log with secrets redacted (AL-214, AL-210).
 */
export const RendererErrorReportSchema = z.object({
  source: z.enum(['boundary', 'window', 'promise']),
  /** Which error boundary caught it (`app`, a page, a lane), when `source` is `boundary`. */
  boundary: z.string().max(RENDERER_ERROR_LIMITS.boundary).optional(),
  name: z.string().max(RENDERER_ERROR_LIMITS.name).optional(),
  message: z.string().max(RENDERER_ERROR_LIMITS.message),
  stack: z.string().max(RENDERER_ERROR_LIMITS.stack).optional(),
  componentStack: z.string().max(RENDERER_ERROR_LIMITS.componentStack).optional(),
});
export type RendererErrorReport = z.infer<typeof RendererErrorReportSchema>;

/** One warning or error from the main-process log, already redacted. */
export const LoggedProblemSchema = z.object({
  at: z.string(),
  level: z.enum(['warn', 'error']),
  /** The part of the app that logged it: `ipc`, `secrets`, `renderer`, … */
  scope: z.string(),
  message: z.string(),
  /** Stack or structured details, redacted and truncated. */
  detail: z.string().optional(),
});
export type LoggedProblem = z.infer<typeof LoggedProblemSchema>;

/**
 * `app:getDiagnostics`: what "Copy diagnostics" puts on the clipboard (AL-214): versions, settings
 * without secrets, and recent errors. Everything in it has been through the log's redactor.
 */
export const DiagnosticsReportSchema = z.object({
  generatedAt: z.string(),
  app: AppInfoSchema,
  os: z.object({ release: z.string(), arch: z.string() }),
  /** Folder holding `main.log` and its rotated copies, with the home folder shown as `~`. */
  logDirectory: z.string(),
  /** The saved settings with secret-looking fields replaced; null when there are none yet. */
  settings: z.unknown(),
  /** Whether the OS can encrypt tokens and how many are saved; never a token. */
  secureStorage: z
    .object({
      encryptionAvailable: z.boolean(),
      savedEntries: z.number().int().nonnegative(),
      issues: z.array(z.string()),
    })
    .nullable(),
  /** Newest last. */
  recentErrors: z.array(LoggedProblemSchema),
  /** The whole report as plain text, ready to paste into a bug report. */
  text: z.string(),
});
export type DiagnosticsReport = z.infer<typeof DiagnosticsReportSchema>;

/** `app:copyDiagnostics`: main wrote the report's text to the clipboard. */
export const DiagnosticsCopiedSchema = z.object({
  characters: z.number().int().nonnegative(),
});
export type DiagnosticsCopied = z.infer<typeof DiagnosticsCopiedSchema>;

export const appInvokeContracts = {
  'app:getInfo': { request: z.undefined(), response: AppInfoSchema },
  'app:getDiagnostics': { request: z.undefined(), response: DiagnosticsReportSchema },
  'app:copyDiagnostics': { request: z.undefined(), response: DiagnosticsCopiedSchema },
  'app:logError': { request: RendererErrorReportSchema, response: z.null() },
} as const satisfies Record<(typeof APP_INVOKE_CHANNELS)[number], InvokeContract>;

/** How a toast looks; error toasts wait for the user, info toasts dismiss themselves (AL-030). */
export const ToastToneSchema = z.enum(['info', 'success', 'warning', 'error']);
export type ToastTone = z.infer<typeof ToastToneSchema>;

/** Buttons a toast may carry before Dismiss; the first is the primary one (artboard 6 "Toast · error"). */
export const TOAST_MAX_ACTIONS = 2;

/** A page a toast action can open: the renderer router's three routes (D13), with a checked ticket id. */
export const ToastRouteSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('board') }),
  z.object({ name: z.literal('ticket'), ticketId: TicketIdSchema }),
  z.object({ name: z.literal('ticketDesign'), ticketId: TicketIdSchema }),
]);
export type ToastRoute = z.infer<typeof ToastRouteSchema>;

/**
 * What a toast action raised by main does when pressed (AL-030). Main can't send a callback across
 * IPC, so it names an intent and the renderer's ToastHost carries it out: `navigate` opens a page.
 * Later tickets add members here (AL-048: Reconnect opens Connections on that row; AL-211: the
 * recovery action for each error code); the renderer's switch over `type` fails the build until
 * every member has a case.
 */
export const ToastIntentSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), route: ToastRouteSchema }),
  // AL-046: Reconnect opens the Connections modal on that row, with its token field focused (design §8).
  z.object({ type: z.literal('openConnections'), connectionId: ConnectionIdSchema.optional() }),
  // AL-110: Reconnect resumes a lost agent session from its saved session id in the same worktree.
  z.object({ type: z.literal('reconnectSession'), ticketId: TicketIdSchema }),
]);
export type ToastIntent = z.infer<typeof ToastIntentSchema>;

/** A button on a toast raised by main: a short label and what pressing it does. */
export const ToastEventActionSchema = z.object({
  label: z.string().min(1).max(40),
  intent: ToastIntentSchema,
});
export type ToastEventAction = z.infer<typeof ToastEventActionSchema>;

/**
 * `toast`: a notice raised by the main process, e.g. a connection that needs reconnecting (design §8).
 * Not tied to one ticket, so it carries only `at` from the envelope. Info toasts close themselves
 * after 5 s; the other tones stay until the user acts on them or dismisses them (AL-030).
 */
export const ToastEventSchema = EventEnvelopeSchema.extend({
  /**
   * Names the notice, e.g. `ado-unauthorized:contoso`. A toast with the id of one still showing
   * replaces it instead of stacking a copy, so a failure that repeats shows once.
   */
  id: z.string().min(1).max(200).optional(),
  tone: ToastToneSchema,
  title: z.string().min(1),
  body: z.string().optional(),
  /** Buttons before Dismiss, primary first. Pressing one carries out its intent and closes the toast. */
  actions: z.array(ToastEventActionSchema).max(TOAST_MAX_ACTIONS).optional(),
});
export type ToastEvent = z.infer<typeof ToastEventSchema>;

/**
 * `app:window` (AL-066): the main window was minimised or hidden (`visible: false`), or restored or
 * shown again (`visible: true`). The renderer stops polling Azure DevOps while it is not visible and
 * refetches when it comes back (design §6); the page's own visibility can't be trusted for this.
 */
export const WindowVisibilityEventSchema = EventEnvelopeSchema.extend({
  visible: z.boolean(),
});
export type WindowVisibilityEvent = z.infer<typeof WindowVisibilityEventSchema>;

export const appEventContracts = {
  toast: ToastEventSchema,
  'app:window': WindowVisibilityEventSchema,
} as const satisfies Record<(typeof APP_EVENT_CHANNELS)[number], z.ZodType>;
