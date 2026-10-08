import { z } from 'zod';
import { TicketIdSchema } from '../events';
import type { TicketDesignSpec } from './tickets.schemas';

// ── Design specs shipped to the ticket's agent (AL-197, AL-198, AL-199, R11, Decisions D8, D16) ─────

/** Longest artboard source kept in a spec; longer sources are cut and say so. */
export const DESIGN_SPEC_SOURCE_MAX = 200_000;
/** Artboards one spec can hold. */
export const DESIGN_SPEC_ARTBOARDS_MAX = 50;
/** Longest note the user adds when approving a spec. */
export const DESIGN_SPEC_NOTE_MAX = 4_000;
/** The design-system file every spec refers to (artboard 4 "agent-lanes-tokens.css · Design system"). */
export const DESIGN_TOKENS_FILE = 'agent-lanes-tokens.css';

/** One artboard as shipped: what the canvas called it, its size, and its source when it was read. */
export const DesignSpecArtboardSchema = z.object({
  /** The artboard's file path in the canvas (AL-195). */
  id: z.string().min(1).max(1024),
  name: z.string().min(1).max(300),
  width: z.int().positive().nullable(),
  height: z.int().positive().nullable(),
  /** Its structure/source at ship time (ClaudeDesign `read_file`); null when it could not be read. */
  source: z.string().max(DESIGN_SPEC_SOURCE_MAX).nullable(),
});
export type DesignSpecArtboard = z.infer<typeof DesignSpecArtboardSchema>;

/**
 * DesignSpec vN (AL-197): a snapshot of the approved design, stored as app-written JSON in the app
 * data folder (D8), never in the worktree. The agent reads it with `agent_lanes.get_design_spec` (D16).
 */
export const DesignSpecSchema = z.object({
  ticketId: TicketIdSchema,
  version: z.int().min(1),
  shippedAt: z.int().nonnegative(),
  /** "Design v2 approved by Kyle". */
  approvedBy: z.string().min(1).max(200),
  /** The user's note to the agent; empty when none. */
  note: z.string().max(DESIGN_SPEC_NOTE_MAX),
  /** The canvas the artboards came from; null when none was linked. */
  canvasUrl: z.string().max(4096).nullable(),
  /** The design system the artboards use: `agent-lanes-tokens.css`, or the project's own. */
  tokensFile: z.string().min(1).max(500),
  artboards: z.array(DesignSpecArtboardSchema).min(1).max(DESIGN_SPEC_ARTBOARDS_MAX),
  /** The version this one replaces (the previous latest); null for v1. */
  supersedes: z.int().min(1).nullable(),
  /** Set when the user shipped an earlier version again (AL-199): this is a copy of that version. */
  reshipOf: z.int().min(1).nullable(),
});
export type DesignSpec = z.infer<typeof DesignSpecSchema>;

/** What happened to a ticket's spec, for `design:spec` (AL-197, AL-198). */
export const DESIGN_SPEC_CHANGES = ['shipped', 'delivered', 'fetched', 'used'] as const;
export const DesignSpecChangeSchema = z.enum(DESIGN_SPEC_CHANGES);
export type DesignSpecChange = z.infer<typeof DesignSpecChangeSchema>;

/** A spec's status in "Attached to this ticket" (artboard 4, AL-199). */
export type DesignSpecStatus = 'sent' | 'used' | 'superseded';

/** Sent until the agent acknowledges it; Superseded once a later version exists. */
export function designSpecStatus(spec: Pick<TicketDesignSpec, 'version' | 'usedAt'>, latestVersion: number): DesignSpecStatus {
  if (spec.version < latestVersion) return 'superseded';
  return spec.usedAt !== null ? 'used' : 'sent';
}

/**
 * "Agent is watching this canvas" (artboard 4, AL-198): the agent fetched the latest spec and has not
 * acknowledged it yet.
 */
export function isAgentWatchingDesign(specs: readonly Pick<TicketDesignSpec, 'usedAt' | 'fetchedAt'>[]): boolean {
  const latest = specs.at(-1);
  return Boolean(latest && latest.usedAt === null && latest.fetchedAt);
}

/** Request for one ticket's spec, by version; the latest when `version` is left out. */
export const DesignSpecRequestSchema = z.strictObject({
  ticketId: TicketIdSchema,
  version: z.int().min(1).optional(),
});
export type DesignSpecRequest = z.infer<typeof DesignSpecRequestSchema>;
