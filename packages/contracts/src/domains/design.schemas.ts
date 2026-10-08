import { z } from 'zod';
import type { InvokeContract } from '../contract';
import { TicketEventEnvelopeSchema, TicketIdSchema } from '../events';
import type { DESIGN_EVENT_CHANNELS, DESIGN_INVOKE_CHANNELS } from './design.names';
import { DesignSpecChangeSchema, ShipDesignSpecRequestSchema, ShippedDesignSpecSchema } from './design.specs';
import { TicketDesignSchema } from './tickets.schemas';

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

// ── Linking a canvas to a ticket (AL-193, D122) ─────────────────────────────────────────────────────

/**
 * `design:linkCanvas`: links the ticket to the Claude Design canvas a pasted link names. Main reads
 * it with `parseDesignCanvasUrl` and refuses anything that is not a canvas link (`VALIDATION`).
 */
export const LinkDesignCanvasRequestSchema = z.object({
  ticketId: TicketIdSchema,
  url: z.string().trim().min(1).max(2048),
});
export type LinkDesignCanvasRequest = z.infer<typeof LinkDesignCanvasRequestSchema>;

/** `design:openCanvas`: shows the ticket's linked canvas over the placeholder, on the page it was last left on. */
export const OpenDesignCanvasRequestSchema = z.object({
  ticketId: TicketIdSchema,
  bounds: DesignViewBoundsSchema.optional(),
});
export type OpenDesignCanvasRequest = z.infer<typeof OpenDesignCanvasRequestSchema>;

// ── Artboards (AL-195, D117, D118) ──────────────────────────────────────────────────────────────────

/** Pixel size of an artboard ("1440×900"); null when the canvas does not say. */
const ArtboardSideSchema = z.int().positive().max(100_000).nullable();

/** One artboard of a canvas, read through the design session ("JobControl · desktop", 1440×900). */
export const DesignArtboardSchema = z.object({
  /** Stable within the canvas: the artboard's file path in the Design project or artifact. */
  id: z.string().min(1).max(1024),
  name: z.string().min(1).max(300),
  width: ArtboardSideSchema,
  height: ArtboardSideSchema,
});
export type DesignArtboard = z.infer<typeof DesignArtboardSchema>;

export const DESIGN_ARTBOARD_LIMIT = 500;

/**
 * `design:listArtboards`: the linked canvas's artboards. `no-canvas` when none is linked;
 * `unavailable` when the Claude login can't reach Claude Design (no claude.ai login, no Design
 * consent, or the org has it off, D119), with a reason for the user.
 */
export const DesignArtboardListSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ok'),
    artboards: z.array(DesignArtboardSchema).max(DESIGN_ARTBOARD_LIMIT),
    /** When main read them (ms since the epoch). */
    readAt: z.int().nonnegative(),
  }),
  z.object({ status: z.literal('no-canvas') }),
  z.object({ status: z.literal('unavailable'), reason: z.string().min(1).max(1000) }),
]);
export type DesignArtboardList = z.infer<typeof DesignArtboardListSchema>;

export const designInvokeContracts = {
  'design:open': { request: OpenDesignViewRequestSchema, response: DesignViewStateSchema },
  'design:setBounds': { request: SetDesignViewBoundsRequestSchema, response: DesignViewFoundResponseSchema },
  'design:hide': { request: DesignViewTicketRequestSchema, response: DesignViewFoundResponseSchema },
  'design:close': { request: DesignViewTicketRequestSchema, response: DesignViewFoundResponseSchema },
  'design:getView': { request: DesignViewTicketRequestSchema, response: GetDesignViewResponseSchema },
  /** Reloads the page the ticket's view shows (the design tab's reload button, AL-192). */
  'design:reload': { request: DesignViewTicketRequestSchema, response: DesignViewFoundResponseSchema },
  /** The ticket record's design after linking (AL-193). */
  'design:linkCanvas': { request: LinkDesignCanvasRequestSchema, response: TicketDesignSchema },
  /** The ticket record's design after unlinking; the canvas view is closed (AL-193). */
  'design:unlinkCanvas': { request: DesignViewTicketRequestSchema, response: TicketDesignSchema },
  /**
   * Opens the linked canvas where the user left it: a live view is shown as it is; otherwise a new
   * view loads the record's last canvas URL, so it reopens on the same artboard after a restart (AL-193).
   */
  'design:openCanvas': { request: OpenDesignCanvasRequestSchema, response: DesignViewStateSchema },
  /** Reads the linked canvas's artboards through a short design session (AL-195, D118). */
  'design:listArtboards': { request: DesignViewTicketRequestSchema, response: DesignArtboardListSchema },
  /** Approve & ship the picked artboards to the ticket's agent as DesignSpec vN, at any stage (AL-197, R11). */
  'design:shipSpec': { request: ShipDesignSpecRequestSchema, response: ShippedDesignSpecSchema },
} as const satisfies Record<(typeof DESIGN_INVOKE_CHANNELS)[number], InvokeContract>;

/**
 * `design:spec`: a design spec was shipped to the ticket's agent or acknowledged by it (AL-197, AL-198).
 * Starts as the ticket envelope `{ ticketId, at }` (AL-012); those tickets add their fields.
 */
export const DesignSpecEventSchema = TicketEventEnvelopeSchema.extend({
  /** The spec version that changed (AL-198). */
  version: z.int().min(1),
  /** `shipped` (AL-197), `delivered` to the agent's session, `fetched` by `get_design_spec`, `used` once acknowledged (AL-198). */
  change: DesignSpecChangeSchema,
});
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
