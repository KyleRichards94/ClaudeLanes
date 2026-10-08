import { z } from 'zod';
import { TEAM_BOARD_COLUMN_KINDS } from '../drop-rules';
import { WorkItemIdSchema } from './ado.ids';

/**
 * The team's Azure DevOps board under the agent lanes (AL-231, T1, TB§6): the user's teams for the
 * dropdown, the board's columns as the team named them, and the sprint's items on it. Read live from
 * ADO; nothing is stored. `ado.schemas.ts` declares the `ado:listTeams` and `ado:teamBoard` channels.
 */

/** A team in the dropdown. */
export const TeamRefSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });
export type TeamRef = z.infer<typeof TeamRefSchema>;

/** `ado:listTeams`: the user's teams in the project, and the one the board opens on. */
export const TeamListSchema = z
  .object({
    teams: z.array(TeamRefSchema),
    /** "Team OSC Developers · from your ADO profile"; null when the user is in no team and the project has no default. */
    defaultTeamId: z.string().min(1).nullable(),
  })
  .refine(({ teams, defaultTeamId }) => defaultTeamId === null || teams.some((team) => team.id === defaultTeamId), {
    message: 'The default team is one of the teams',
    path: ['defaultTeamId'],
  });
export type TeamList = z.infer<typeof TeamListSchema>;

/** Which of the app's columns a board column maps to; `other` for one it doesn't know (shown, not dropped). */
export const TeamBoardColumnKindSchema = z.enum([...TEAM_BOARD_COLUMN_KINDS, 'other']);
export type TeamBoardColumnKindOrOther = z.infer<typeof TeamBoardColumnKindSchema>;

/** One column, named as the team's ADO board names it ("To Do", "Failed UAT"). */
export const TeamBoardColumnSchema = z.object({
  /** ADO's column id; a column only items know about (not in the board settings) gets `unknown:<name>`. */
  id: z.string().min(1),
  name: z.string().min(1),
  kind: TeamBoardColumnKindSchema,
});
export type TeamBoardColumn = z.infer<typeof TeamBoardColumnSchema>;

/** Someone on a card: name and initials for the avatar, ids for the drop rules (`isMe`). */
export const TeamBoardPersonSchema = z.object({
  /** ADO identity id; null when ADO sent none (older servers). */
  id: z.string().min(1).nullable(),
  displayName: z.string(),
  uniqueName: z.string().nullable(),
  /** "KR" for Kyle Richards (artboard 08). */
  initials: z.string().min(1).max(2),
});
export type TeamBoardPerson = z.infer<typeof TeamBoardPersonSchema>;

/** One card on the team board (artboard 08). */
export const TeamBoardItemSchema = z.object({
  id: WorkItemIdSchema,
  /** As ADO names it: "Bug", "User Story". */
  type: z.string().min(1),
  title: z.string(),
  /** `System.State` ("Resolved", "Failed UAT"). */
  state: z.string(),
  /** Story points, effort or size, whichever the process uses; null when not estimated. */
  points: z.number().nonnegative().nullable(),
  /** The column's `id` in `TeamBoard.columns`. */
  columnId: z.string().min(1),
  /** The column's name, as on the board. */
  column: z.string().min(1),
  columnKind: TeamBoardColumnKindSchema,
  assignee: TeamBoardPersonSchema.nullable(),
  /** The item's linked branch (without `refs/heads/`), or null. */
  branch: z.string().min(1).nullable(),
  /** The item's linked pull request (the newest when several), or null. */
  pullRequestId: z.int().positive().nullable(),
  webUrl: z.url({ protocol: /^https?$/ }),
});
export type TeamBoardItem = z.infer<typeof TeamBoardItemSchema>;

/** `ado:teamBoard`: a team's board for one sprint. Items are in column order, then by id. */
export const TeamBoardSchema = z.object({
  team: TeamRefSchema,
  sprint: z.object({ id: z.string().min(1), name: z.string().min(1), path: z.string().min(1) }),
  /** The board's columns left to right (its Done column left out), then any column only items named. */
  columns: z.array(TeamBoardColumnSchema),
  items: z.array(TeamBoardItemSchema),
});
export type TeamBoard = z.infer<typeof TeamBoardSchema>;

/**
 * Two letters for an avatar: first and last name's initials ("Kyle Richards" → "KR"), or a single
 * name's first two letters ("MD" stays "MD"). Text in `<…>` or `(…)` is ignored.
 */
export function initialsOf(displayName: string): string {
  const words = displayName
    .replace(/<[^>]*>|\([^)]*\)/g, ' ')
    .split(/[\s._-]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
  if (words.length === 0) return '?';
  const letters = words.length === 1 ? [...words[0]!].slice(0, 2).join('') : `${[...words[0]!][0]}${[...words.at(-1)!][0]}`;
  return letters.toUpperCase();
}
