import { z } from 'zod';
import type { DropAction } from '../drop-rules';
import { EffortSchema, ModelSchema } from '../vocabulary';

/**
 * Per-lane drop defaults (AL-240, TB§3 "The defaults are set per lane in Settings"): the skills, model
 * and effort an agent started by a team board drop runs with. Implementing has two rows because an
 * item and your own PR start different agents there. Seeded from the TB§3 table.
 */

/** The kinds of drop that start an agent, one Settings row each. */
export const DROP_KINDS = ['planning', 'implementing', 'answer-comments', 'code-review', 'qa'] as const;
export const DropKindSchema = z.enum(DROP_KINDS);
export type DropKind = z.infer<typeof DropKindSchema>;

/** The Settings › Drops row labels. */
export const DROP_KIND_LABELS: Readonly<Record<DropKind, { lane: string; what: string }>> = {
  planning: { lane: 'Planning', what: 'To Do, Failed, backlog or your In Progress item' },
  implementing: { lane: 'Implementing', what: 'To Do, Failed, backlog or your In Progress item' },
  'answer-comments': { lane: 'Implementing', what: 'Your open PR with comments' },
  'code-review': { lane: 'Code review', what: 'Code Review item or any open PR' },
  qa: { lane: 'QA', what: 'Testing item' },
};

export const LaneDropDefaultsSchema = z.object({
  /** Skill names without the leading slash, run in this order. */
  skills: z.array(z.string().trim().min(1).max(200)).max(16),
  model: ModelSchema,
  effort: EffortSchema,
});
export type LaneDropDefaults = z.infer<typeof LaneDropDefaultsSchema>;

export const DropDefaultsSchema = z.object(Object.fromEntries(DROP_KINDS.map((kind) => [kind, LaneDropDefaultsSchema])) as Record<DropKind, typeof LaneDropDefaultsSchema>);
export type DropDefaults = z.infer<typeof DropDefaultsSchema>;

/** TB§3's defaults: Opus High to plan and build, /code-review + /pr-comment-actioner on Opus High to review, /pr-comment-actioner on Sonnet High to answer, /cs-qa-wip on Sonnet Medium for QA. */
export function defaultDropDefaults(): DropDefaults {
  return {
    planning: { skills: [], model: 'opus', effort: 'high' },
    implementing: { skills: [], model: 'opus', effort: 'high' },
    'answer-comments': { skills: ['pr-comment-actioner'], model: 'sonnet', effort: 'high' },
    'code-review': { skills: ['code-review', 'pr-comment-actioner'], model: 'opus', effort: 'high' },
    qa: { skills: ['cs-qa-wip'], model: 'sonnet', effort: 'medium' },
  };
}

/** Which Settings row a drop's action takes its defaults from. */
export function dropKindOf(action: Pick<DropAction, 'lane' | 'worktree'>): DropKind {
  if (action.worktree === 'pr-source-branch') return 'answer-comments';
  if (action.lane === 'code-review') return 'code-review';
  if (action.lane === 'qa') return 'qa';
  return action.lane === 'implementing' ? 'implementing' : 'planning';
}

/** The drop defaults in force: what Settings › Drops saved, else TB§3's (a row never saved keeps its default). */
export function dropDefaultsOf(settings: { dropDefaults?: Partial<DropDefaults> | undefined }): DropDefaults {
  return { ...defaultDropDefaults(), ...settings.dropDefaults };
}
