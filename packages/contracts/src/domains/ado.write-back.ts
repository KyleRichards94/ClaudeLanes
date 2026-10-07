import { z } from 'zod';
import { WorkItemIdSchema } from './ado.ids';

/**
 * Work item write-back (AL-063, design §7 "ADO write-back"): the comments Agent Lanes posts to a
 * work item's discussion, and the optional state change, which runs only while Settings › ADO state
 * transitions (`adoStateTransitions`) is on. Off by default.
 *
 * The main process posts them through `@agent-lanes/ado-client`; these DTOs are what it hands to
 * other services and, through AL-065's channels, to the renderer (the ADO tab, AL-180).
 */

/** Starts every comment the app posts, so people reading the work item can tell them apart. */
export const AGENT_LANES_COMMENT_PREFIX = 'Agent Lanes · ';

/**
 * The most characters of comment text the app sends, before the prefix and HTML escaping. A
 * write-back is a short status line ("Agent Lanes · Implementing — plan approved by Kyle"); longer
 * text belongs in the PR description.
 */
export const WORK_ITEM_COMMENT_MAX_LENGTH = 10_000;

/** A workflow state name as the work item type defines it (`Active`, `Resolved`, `Done`). */
export const WorkItemStateNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[^\p{Cc}]+$/u, 'A state name has no control characters');

/** Comment text the app is asked to post: plain text, not HTML, without the prefix. */
export const WorkItemCommentTextSchema = z.string().trim().min(1).max(WORK_ITEM_COMMENT_MAX_LENGTH);

/** How ADO stores a comment's text. The app posts HTML; people may write either. */
export const WORK_ITEM_COMMENT_FORMATS = ['html', 'markdown'] as const;
export const WorkItemCommentFormatSchema = z.enum(WORK_ITEM_COMMENT_FORMATS);
export type WorkItemCommentFormat = z.infer<typeof WorkItemCommentFormatSchema>;

/** One comment in a work item's discussion, read from or posted through the Comments API. */
export const WorkItemCommentSchema = z.object({
  /** ADO's comment id, unique within the work item. */
  id: z.int().min(1),
  workItemId: WorkItemIdSchema,
  /**
   * As ADO stores it: HTML (or Markdown, see `format`) written by a person or by the app. Never
   * render it as HTML; the ADO tab sanitises it first (AL-180).
   */
  text: z.string(),
  format: WorkItemCommentFormatSchema,
  /** Display name of whoever posted it; for app comments, the PAT's owner. Null when ADO leaves it out. */
  author: z.string().nullable(),
  createdAt: z.iso.datetime(),
  /** Null until the comment is edited. */
  updatedAt: z.iso.datetime().nullable(),
  /** The text starts with "Agent Lanes ·": the app posted it. */
  fromAgentLanes: z.boolean(),
});
export type WorkItemComment = z.infer<typeof WorkItemCommentSchema>;

const changedStateSchema = z.object({
  outcome: z.literal('changed'),
  workItemId: WorkItemIdSchema,
  /** The state now, as ADO reports it after the change. */
  state: z.string().min(1),
  previousState: z.string().min(1),
  /** The work item's revision after the change. */
  rev: z.int().min(1),
});

const unchangedStateSchema = z.object({
  outcome: z.literal('unchanged'),
  workItemId: WorkItemIdSchema,
  /** The work item was already in this state, so nothing was written. */
  state: z.string().min(1),
  rev: z.int().min(1),
});

/** What a state change did in ADO: moved the work item, or found it already there. */
export const WorkItemStateChangeSchema = z.discriminatedUnion('outcome', [changedStateSchema, unchangedStateSchema]);
export type WorkItemStateChange = z.infer<typeof WorkItemStateChangeSchema>;

/**
 * What a state write-back did: `disabled` when Settings › ADO state transitions is off (the
 * default), in which case ADO was not called at all.
 */
export const WorkItemStateWriteBackSchema = z.discriminatedUnion('outcome', [
  changedStateSchema,
  unchangedStateSchema,
  z.object({ outcome: z.literal('disabled'), workItemId: WorkItemIdSchema }),
]);
export type WorkItemStateWriteBack = z.infer<typeof WorkItemStateWriteBackSchema>;

/** Leading whitespace, `&nbsp;` and tags (`<div>`, `<p>`) ADO or an editor may wrap a comment in. */
const LEADING_MARKUP = /^(?:\s|&nbsp;|<[^>]*>)*/i;
/** Enough of a comment's start to find the prefix behind any wrapping markup. */
const PREFIX_SEARCH_LENGTH = 2_000;

/**
 * True when a comment's text (plain, HTML or Markdown) starts with "Agent Lanes ·", whether ADO
 * kept the middle dot as is or as an entity, and whatever markup it wrapped the text in.
 */
export function isAgentLanesComment(text: string): boolean {
  const start = text
    .slice(0, PREFIX_SEARCH_LENGTH)
    .replace(LEADING_MARKUP, '')
    .slice(0, 64)
    .replace(/&middot;|&#183;|&#x0*b7;/gi, '·')
    .replace(/&nbsp;|&#160;|&#xa0;|\u00a0/gi, ' ');
  return start.startsWith(AGENT_LANES_COMMENT_PREFIX.trimEnd());
}

/** Plain `text` with the "Agent Lanes · " prefix, added only when it doesn't start with it already. */
export function withAgentLanesPrefix(text: string): string {
  return text.startsWith(AGENT_LANES_COMMENT_PREFIX.trimEnd()) ? text : `${AGENT_LANES_COMMENT_PREFIX}${text}`;
}
