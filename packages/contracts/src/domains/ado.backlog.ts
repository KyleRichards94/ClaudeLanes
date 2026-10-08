import { z } from 'zod';
import { WorkItemIdSchema } from './ado.ids';
import { TeamBoardPersonSchema, TeamRefSchema } from './ado.team-board';

/**
 * The Backlog popout's data (AL-233, T6, TB§5): the profile team's backlog in backlog order, grouped
 * by parent Feature, one page at a time. `ado.schemas.ts` declares `ado:backlog` and its filters.
 */

/** The type filter on artboard 11 (All / Story / Bug / Task), by ADO's backlog levels, not type names. */
export const BACKLOG_KINDS = ['story', 'bug', 'task'] as const;
export const BacklogKindSchema = z.enum(BACKLOG_KINDS);
export type BacklogKind = z.infer<typeof BacklogKindSchema>;

/** Rows a page holds by default. */
export const BACKLOG_PAGE_SIZE = 50;
/** Most rows one page may ask for (one `workitemsbatch` read). */
export const BACKLOG_PAGE_SIZE_MAX = 200;

/** One backlog row (artboard 11: grip, checkbox, `#71360`, Story, title, tag, "5 pts", priority 1). */
export const BacklogItemSchema = z.object({
  id: WorkItemIdSchema,
  /** As ADO names it: "User Story", "Bug", "Task". */
  type: z.string().min(1),
  kind: z.enum([...BACKLOG_KINDS, 'other']),
  title: z.string(),
  state: z.string(),
  points: z.number().nonnegative().nullable(),
  /** 1 (highest) to 4; null when not set. */
  priority: z.int().nullable(),
  tags: z.array(z.string().min(1)),
  areaPath: z.string(),
  iterationPath: z.string(),
  /** Already in a sprint (shown only with "include items already in a sprint"). */
  inSprint: z.boolean(),
  assignee: TeamBoardPersonSchema.nullable(),
  /** The direct parent, or null. */
  parentId: WorkItemIdSchema.nullable(),
  webUrl: z.url({ protocol: /^https?$/ }),
});
export type BacklogItem = z.infer<typeof BacklogItemSchema>;

/** Rows under one Feature ("Job management 3"); `feature` null for rows with no Feature above them. */
export const BacklogGroupSchema = z.object({
  feature: z.object({ id: WorkItemIdSchema, title: z.string() }).nullable(),
  items: z.array(BacklogItemSchema).min(1),
});
export type BacklogGroup = z.infer<typeof BacklogGroupSchema>;

/** `ado:backlog`: one page of the filtered backlog, grouped. */
export const BacklogPageSchema = z.object({
  team: TeamRefSchema,
  /** Rows matching the filters, on every page ("48 items"). */
  total: z.int().nonnegative(),
  page: z.object({
    index: z.int().nonnegative(),
    size: z.int().min(1).max(BACKLOG_PAGE_SIZE_MAX),
    /** Pages at this size; 0 when nothing matches. */
    count: z.int().nonnegative(),
  }),
  /** The page's rows in backlog order, grouped by Feature in order of each Feature's first row. */
  groups: z.array(BacklogGroupSchema),
});
export type BacklogPage = z.infer<typeof BacklogPageSchema>;
