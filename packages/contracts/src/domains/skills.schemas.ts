import { z } from 'zod';
import type { InvokeContract } from '../contract';
import type { SKILLS_EVENT_CHANNELS, SKILLS_INVOKE_CHANNELS } from './skills.names';

// ── Skill discovery (AL-114, artboard 2 Skills, artboard 3 shortcuts) ──────────────────────────────
//
// The skills a repo's agents can run, as Claude Code itself lists them: main starts a short session
// with the repo's configuration (the repo's own `.claude/skills` and commands, the user's skills,
// plugins), asks it with `supportedCommands()` and closes it. Claude Code's built-in commands are
// left out. Cached per repo until the user refreshes.

/** One skill: what the chip sends as `/name` (AL-105) and the description its tooltip shows. */
export const SkillInfoSchema = z.object({
  /** Without the slash: `code-review`, `osc-blazor-cutover-invoke`, `plugin:skill`. */
  name: z.string().min(1).max(200),
  description: z.string().max(2000),
  /** "<file>", or empty when the skill takes no arguments. */
  argumentHint: z.string().max(500),
});
export type SkillInfo = z.infer<typeof SkillInfoSchema>;

/** `skills:list`: a registered repo's skills; `refresh` asks Claude Code again instead of using the cache. */
export const ListSkillsRequestSchema = z.strictObject({
  /** The registered repo's main checkout, as in settings. */
  repo: z.string().min(1).max(4096),
  refresh: z.boolean().optional(),
});
export type ListSkillsRequest = z.infer<typeof ListSkillsRequestSchema>;

export const ListSkillsResponseSchema = z.object({
  repo: z.string().min(1),
  /** By name. */
  skills: z.array(SkillInfoSchema).max(1000),
  /** When Claude Code was asked (epoch ms); older lists came from the cache. */
  loadedAt: z.int().nonnegative(),
});
export type ListSkillsResponse = z.infer<typeof ListSkillsResponseSchema>;

export const skillsInvokeContracts = {
  'skills:list': { request: ListSkillsRequestSchema, response: ListSkillsResponseSchema },
} as const satisfies Record<(typeof SKILLS_INVOKE_CHANNELS)[number], InvokeContract>;

export const skillsEventContracts = {} as const satisfies Record<(typeof SKILLS_EVENT_CHANNELS)[number], z.ZodType>;
