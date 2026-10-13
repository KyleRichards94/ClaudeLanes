import { z } from 'zod';
import type { DropAction } from '../drop-rules';
import { EffortSchema, ModelSchema } from '../vocabulary';

/**
 * Per-lane drop defaults (AL-240, TB§3 "The defaults are set per lane in Settings"): the skills, model
 * and effort an agent started by a team board drop runs with, and an initial prompt added to its first
 * turn. Implementing has two rows because an item and your own PR start different agents there; each
 * single-step lane has its own row. Seeded from the TB§3 table.
 */

/** The kinds of drop that start an agent, one Settings row each. */
export const DROP_KINDS = ['planning', 'implementing', 'answer-comments', 'code-review', 'qa', 'review-only', 'qa-only', 'pr-only', 'comments-only'] as const;
export const DropKindSchema = z.enum(DROP_KINDS);
export type DropKind = z.infer<typeof DropKindSchema>;

/** The Settings › Drops row labels. */
export const DROP_KIND_LABELS: Readonly<Record<DropKind, { lane: string; what: string }>> = {
  planning: { lane: 'Planning', what: 'To Do, Failed, backlog or your In Progress item' },
  implementing: { lane: 'Implementing', what: 'To Do, Failed, backlog or your In Progress item' },
  'answer-comments': { lane: 'Implementing', what: 'Your open PR with comments' },
  'code-review': { lane: 'Code review', what: 'Code Review item or any open PR' },
  qa: { lane: 'QA', what: 'Testing item' },
  'review-only': { lane: 'Code review only', what: 'Any open PR, or an item with a PR or branch' },
  'qa-only': { lane: 'QA only', what: 'Your or an unassigned item' },
  'pr-only': { lane: 'Create PR only', what: 'Your or an unassigned item with a branch' },
  'comments-only': { lane: 'Resolve PR comments', what: 'Your open PR with comments, or its item' },
};

/** Longest initial prompt a row takes. */
export const DROP_PROMPT_MAX = 4000;

export const LaneDropDefaultsSchema = z.object({
  /** Skill names without the leading slash, run in this order. */
  skills: z.array(z.string().trim().min(1).max(200)).max(16),
  model: ModelSchema,
  effort: EffortSchema,
  /** Added to the agent's first turn, after the app's own job text; empty adds nothing. Absent on rows saved before it existed. */
  prompt: z.string().max(DROP_PROMPT_MAX).optional(),
});
export type LaneDropDefaults = z.infer<typeof LaneDropDefaultsSchema>;

/** As saved: a row saved before its lane existed is absent and takes the default (`dropDefaultsOf`). */
export const DropDefaultsSchema = z.object(
  Object.fromEntries(DROP_KINDS.map((kind) => [kind, LaneDropDefaultsSchema.optional()])) as Record<DropKind, z.ZodOptional<typeof LaneDropDefaultsSchema>>,
);
export type StoredDropDefaults = z.infer<typeof DropDefaultsSchema>;
/** Every row, filled in. */
export type DropDefaults = Record<DropKind, LaneDropDefaults>;

/** TB§3's defaults: Opus High to plan and build, /code-review + /pr-comment-actioner on Opus High to review, /pr-comment-actioner on Sonnet High to answer, /cs-qa-wip on Sonnet Medium for QA. */
export function defaultDropDefaults(): DropDefaults {
  return {
    planning: { skills: [], model: 'opus', effort: 'high', prompt: '' },
    implementing: { skills: [], model: 'opus', effort: 'high', prompt: '' },
    'answer-comments': { skills: ['pr-comment-actioner'], model: 'sonnet', effort: 'high', prompt: '' },
    'code-review': { skills: ['code-review', 'pr-comment-actioner'], model: 'opus', effort: 'high', prompt: '' },
    qa: { skills: ['cs-qa-wip'], model: 'sonnet', effort: 'medium', prompt: '' },
    'review-only': { skills: ['code-review'], model: 'opus', effort: 'high', prompt: '' },
    'qa-only': { skills: ['cs-qa-wip'], model: 'sonnet', effort: 'medium', prompt: '' },
    'pr-only': { skills: [], model: 'sonnet', effort: 'medium', prompt: '' },
    'comments-only': { skills: ['pr-comment-actioner'], model: 'sonnet', effort: 'high', prompt: '' },
  };
}

/** Which Settings row a drop's action takes its defaults from. */
export function dropKindOf(action: Pick<DropAction, 'lane' | 'worktree'>): DropKind {
  // A single-step lane is its own row.
  if (action.lane === 'review-only' || action.lane === 'qa-only' || action.lane === 'pr-only' || action.lane === 'comments-only') return action.lane;
  if (action.worktree === 'pr-source-branch') return 'answer-comments';
  if (action.lane === 'code-review') return 'code-review';
  if (action.lane === 'qa') return 'qa';
  return action.lane === 'implementing' ? 'implementing' : 'planning';
}

/** The drop defaults in force: what Settings › Drops saved, else TB§3's (a row never saved keeps its default). */
export function dropDefaultsOf(settings: { dropDefaults?: Partial<Record<DropKind, Partial<LaneDropDefaults> | undefined>> | undefined }): DropDefaults {
  const defaults = defaultDropDefaults();
  for (const kind of DROP_KINDS) {
    const saved = settings.dropDefaults?.[kind];
    if (saved) defaults[kind] = { ...defaults[kind], ...saved };
  }
  return defaults;
}
