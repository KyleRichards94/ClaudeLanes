import { z } from 'zod';
import type { InvokeContract } from '../contract';
import { TicketEventEnvelopeSchema, TicketIdSchema } from '../events';
import type { DESIGN_EVENT_CHANNELS, DESIGN_INVOKE_CHANNELS } from './design.names';

// ── Design view (AL-191, design §4 Design view, R10, R11) ──────────────────────────────────────────

/**
 * Where the canvas placeholder sits in the renderer, in CSS pixels relative to the window's content
 * area (`getBoundingClientRect()`). Main rounds the values and applies the renderer's zoom factor.
 */
export const DesignViewBoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});
export type DesignViewBounds = z.infer<typeof DesignViewBoundsSchema>;

/**
 * What the ticket's canvas view is showing, for the "Webview · signed in" pill (AL-192):
 * `loading` until the first page commits, `signed-in` on a claude.ai page that is not a sign-in page,
 * `signed-out` on a claude.ai sign-in page or an identity provider's page, `load-failed` when the
 * page could not load (offline, refused, blocked).
 */
export const DESIGN_VIEW_STATUSES = ['loading', 'signed-in', 'signed-out', 'load-failed'] as const;
export const DesignViewStatusSchema = z.enum(DESIGN_VIEW_STATUSES);
export type DesignViewStatus = z.infer<typeof DesignViewStatusSchema>;

/** One ticket's live canvas view. Views are hidden, never destroyed, when the user leaves the tab (R11). */
export const DesignViewStateSchema = z.object({
  ticketId: TicketIdSchema,
  status: DesignViewStatusSchema,
  /**
   * The page the view shows now, for AL-193 to reopen the same artboard. Query and fragment are
   * dropped on sign-in and identity-provider pages, which can carry one-time sign-in tokens.
   */
  url: z.string().nullable(),
  /** False while the view is parked behind the renderer (another tab or page is showing). */
  visible: z.boolean(),
});
export type DesignViewState = z.infer<typeof DesignViewStateSchema>;

/**
 * `design:open`: shows the ticket's canvas over the placeholder. The view is created on first open
 * and loads `url`; a later open of the same canvas only shows it again, so scroll, selection and the
 * canvas chat draft are kept. A different `url` (the ticket was linked to another canvas) navigates.
 * Main refuses URLs outside the navigation allow-list (claude.ai and its sign-in hosts).
 */
export const OpenDesignViewRequestSchema = z.object({
  ticketId: TicketIdSchema,
  url: z.url().max(2048),
  bounds: DesignViewBoundsSchema.optional(),
});
export type OpenDesignViewRequest = z.infer<typeof OpenDesignViewRequestSchema>;

/** `design:setBounds`: the placeholder moved or resized (renderer `ResizeObserver`). */
export const SetDesignViewBoundsRequestSchema = z.object({
  ticketId: TicketIdSchema,
  bounds: DesignViewBoundsSchema,
});
export type SetDesignViewBoundsRequest = z.infer<typeof SetDesignViewBoundsRequestSchema>;

/** `design:hide`, `design:close`, `design:getView`: one ticket's view. */
export const DesignViewTicketRequestSchema = z.object({ ticketId: TicketIdSchema });
export type DesignViewTicketRequest = z.infer<typeof DesignViewTicketRequestSchema>;

/** False when the ticket has no live view (never opened, closed, or evicted by the live-view limit). */
export const DesignViewFoundResponseSchema = z.object({ found: z.boolean() });
export type DesignViewFoundResponse = z.infer<typeof DesignViewFoundResponseSchema>;

/** `design:getView`: the ticket's live view, or null when it has none. */
export const GetDesignViewResponseSchema = z.object({ view: DesignViewStateSchema.nullable() });
export type GetDesignViewResponse = z.infer<typeof GetDesignViewResponseSchema>;

export const designInvokeContracts = {
  'design:open': { request: OpenDesignViewRequestSchema, response: DesignViewStateSchema },
  'design:setBounds': { request: SetDesignViewBoundsRequestSchema, response: DesignViewFoundResponseSchema },
  'design:hide': { request: DesignViewTicketRequestSchema, response: DesignViewFoundResponseSchema },
  'design:close': { request: DesignViewTicketRequestSchema, response: DesignViewFoundResponseSchema },
  'design:getView': { request: DesignViewTicketRequestSchema, response: GetDesignViewResponseSchema },
  /** Reloads the page the ticket's view shows (the design tab's reload button, AL-192). */
  'design:reload': { request: DesignViewTicketRequestSchema, response: DesignViewFoundResponseSchema },
} as const satisfies Record<(typeof DESIGN_INVOKE_CHANNELS)[number], InvokeContract>;

/**
 * `design:spec`: a design spec was shipped to the ticket's agent or acknowledged by it (AL-197, AL-198).
 * Starts as the ticket envelope `{ ticketId, at }` (AL-012); those tickets add their fields.
 */
export const DesignSpecEventSchema = TicketEventEnvelopeSchema.extend({});
export type DesignSpecEvent = z.infer<typeof DesignSpecEventSchema>;

/**
 * `design:view`: a ticket's canvas view changed status or page, was shown or hidden, or was closed
 * (`closed: true`, e.g. evicted by the live-view limit). Drives the design tab's sign-in pill (AL-192).
 */
export const DesignViewEventSchema = TicketEventEnvelopeSchema.extend({
  status: DesignViewStatusSchema,
  url: z.string().nullable(),
  visible: z.boolean(),
  closed: z.boolean(),
});
export type DesignViewEvent = z.infer<typeof DesignViewEventSchema>;

export const designEventContracts = {
  'design:spec': DesignSpecEventSchema,
  'design:view': DesignViewEventSchema,
} as const satisfies Record<(typeof DESIGN_EVENT_CHANNELS)[number], z.ZodType>;
