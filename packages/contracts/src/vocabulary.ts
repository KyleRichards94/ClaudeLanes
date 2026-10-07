import { z } from 'zod';

/**
 * Value vocabularies that more than one domain uses (settings, tickets, agent sessions, the board).
 * Declared once here so every domain's schemas and the UI agree on the spelling.
 */

/** The five agent stages, in order (design §1, §9). */
export const STAGES = ['planning', 'implementing', 'code-review', 'qa', 'create-pr'] as const;
export const StageSchema = z.enum(STAGES);
export type Stage = z.infer<typeof StageSchema>;

/** Board lanes, left to right: Queued, the five stages, then Done (artboard 1). */
export const LANES = ['queued', ...STAGES, 'done'] as const;
export const LaneSchema = z.enum(LANES);
export type Lane = z.infer<typeof LaneSchema>;

/** Model cards on artboard 2. Their SDK model ids are `MODEL_IDS` below (Decision D10). */
export const MODELS = ['opus', 'sonnet', 'haiku'] as const;
export const ModelSchema = z.enum(MODELS);
export type Model = z.infer<typeof ModelSchema>;

/**
 * The Agent SDK model id each model card starts a session with (Decision D10, current as of
 * 2026-10-07). The one place these ids live: sessions (AL-100) and live model changes read them here.
 */
export const MODEL_IDS = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5-5',
  haiku: 'claude-haiku-4-5',
} as const satisfies Readonly<Record<Model, string>>;

/** The SDK model id for a model card (`opus` → `claude-opus-5-5`). */
export function modelId(model: Model): (typeof MODEL_IDS)[Model] {
  return MODEL_IDS[model];
}

/** Effort Low / Med / High / XHigh / Max, spelled as the SDK's `effortLevel` (Decision D10). */
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const EffortSchema = z.enum(EFFORTS);
export type Effort = z.infer<typeof EffortSchema>;

/** A stage either runs on (`auto`) or waits for the user (`approval`, "Needs approval") (design §9). */
export const GATES = ['auto', 'approval'] as const;
export const GateSchema = z.enum(GATES);
export type Gate = z.infer<typeof GateSchema>;

/** How the Claude Design tab shows a ticket's canvas (design §7, artboard 4). */
export const EMBED_MODES = ['webview', 'mcp-link'] as const;
export const EmbedModeSchema = z.enum(EMBED_MODES);
export type EmbedMode = z.infer<typeof EmbedModeSchema>;
