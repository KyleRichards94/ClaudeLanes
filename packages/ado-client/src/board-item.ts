import { initialsOf, ok, type BoardItemUpdate, type Result, type TeamBoardPerson, type TeamMemberList } from '@agent-lanes/contracts';
import { z } from 'zod';
import { getWorkItemAssignment, setWorkItemAssignment, type AdoPerson, type AssigneeIdentity, type AssignmentCallOptions } from './assignment';
import type { AdoClient } from './client';
import { DEFAULT_MAX_PAGES } from './constants';
import { adoErr } from './errors';
import { adoPath } from './path';
import { columnTargetOf, guarded, isName, missing, resolveTeam, sameText, type TeamCallOptions } from './team-board';

/**
 * Opening a team-board card (AL-285): the team's people, and a direct edit that assigns someone
 * and/or moves the card to a column. Dragging onto an agent lane is a different path. Never throws.
 */

export interface TeamMembersOptions extends TeamCallOptions {
  project: string;
  /** Team name or id. Omitted, the user's default team. */
  team?: string;
}

/** Team members per page. */
export const TEAM_MEMBER_PAGE_SIZE = 100;

const identitySchema = z.object({
  id: z.string().min(1),
  displayName: z.string().nullish(),
  uniqueName: z.string().nullish(),
  isContainer: z.boolean().nullish(),
});
const membersPageSchema = z.object({ value: z.array(z.object({ identity: identitySchema })) });

/** The people on a team, by display name, for the card's person list. Groups (containers) are left out. */
export function listTeamMembers(client: AdoClient, options: TeamMembersOptions): Promise<Result<TeamMemberList>> {
  return guarded('list the team', async () => {
    if (!isName(options.project)) return missing('project', 'list its people');
    const call = callOptions(options);
    const team = await resolveTeam(client, options.project, options.team, call);
    if (!team.ok) return team;
    const pages = await readPages(
      client,
      adoPath`/_apis/projects/${options.project.trim()}/teams/${team.data.id}/members`,
      membersPageSchema,
      call,
    );
    if (!pages.ok) return pages;
    const seen = new Set<string>();
    const members: TeamBoardPerson[] = [];
    for (const row of pages.data) {
      const identity = row.identity;
      if (identity.isContainer || seen.has(identity.id.toLowerCase())) continue;
      seen.add(identity.id.toLowerCase());
      const displayName = identity.displayName?.trim() || identity.uniqueName?.trim() || 'Unknown';
      members.push({ id: identity.id, displayName, uniqueName: identity.uniqueName ?? null, initials: initialsOf(displayName) });
    }
    members.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return ok({ team: team.data, members });
  });
}

export interface UpdateBoardItemOptions extends TeamCallOptions {
  project: string;
  /** Team name or id. Omitted, the user's default team. Needed to find the column. */
  team?: string;
  workItemId: number;
  /** Left out, the assignee stays. Null clears it. */
  assignee?: AssigneeIdentity | null;
  /** A column id or name on the team's board. Left out, the card stays where it is. */
  columnId?: string;
}

/**
 * Assigns a person, moves the card to a board column, or both, in one guarded revision. The column
 * write sets the state that column maps the work item's type to, and the team's column field so a
 * card moves between columns that share a state. When the server refuses the column field, the state
 * (and the person) are written without it. Never throws.
 */
export function updateBoardItem(client: AdoClient, options: UpdateBoardItemOptions): Promise<Result<BoardItemUpdate>> {
  return guarded('update the work item', async () => {
    if (options.assignee === undefined && options.columnId === undefined) {
      return adoErr('VALIDATION', 'Choose a person or a column.', { kind: 'config' });
    }
    if (!isName(options.project)) return missing('project', 'update a work item');
    const call = callOptions(options);
    const ref = { project: options.project, workItemId: options.workItemId };
    const current = await getWorkItemAssignment(client, ref, call);
    if (!current.ok) return current;

    const found = options.columnId === undefined ? null : await columnTargetOf(client, options.project, options.team, current.data.type, options.columnId, call);
    if (found && !found.ok) return found;
    const target = found?.ok ? found.data : null;

    const base = {
      expectedRev: current.data.rev,
      ...(options.assignee === undefined ? {} : { assignee: options.assignee }),
      state: target?.state ?? null,
    };
    const withColumn = target?.field ? { ...base, fields: { [target.field]: target.column } } : base;
    let fieldWritten = false;
    let written = await setWorkItemAssignment(client, ref, withColumn, call);
    if (written.ok) fieldWritten = Boolean(target?.field);
    else if (target?.field && !changedSince(written)) {
      const again = await setWorkItemAssignment(client, ref, base, call);
      if (again.ok || changedSince(again)) written = again;
    }
    if (!written.ok) return written;

    // Claim the column only when its field was written, or when the board has no column field and the
    // state change is what places the card. A refused column field must not report the move.
    const columnApplied = target !== null && (fieldWritten || (target.field === null && !sameText(written.data.state, current.data.state)));
    return ok({
      workItemId: written.data.workItemId,
      rev: written.data.rev,
      state: written.data.state,
      assignee: toAssignee(written.data.assignee),
      columnId: columnApplied ? target.columnId : null,
      column: columnApplied ? target.column : null,
    });
  });
}

function toAssignee(person: AdoPerson | null): BoardItemUpdate['assignee'] {
  return person ? { id: person.id, displayName: person.displayName, uniqueName: person.uniqueName } : null;
}

function changedSince(result: Result<unknown>): boolean {
  return !result.ok && typeof result.details === 'object' && result.details !== null && (result.details as { reason?: unknown }).reason === 'changed';
}

function callOptions({ signal, timeoutMs }: TeamCallOptions): AssignmentCallOptions {
  return { ...(signal ? { signal } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
}

async function readPages<T>(client: AdoClient, path: string, schema: z.ZodType<{ value: T[] }>, call: TeamCallOptions): Promise<Result<T[]>> {
  const items: T[] = [];
  for (let page = 0; page < DEFAULT_MAX_PAGES; page += 1) {
    const received = await client.get(path, schema, { ...call, query: { $top: TEAM_MEMBER_PAGE_SIZE, $skip: page * TEAM_MEMBER_PAGE_SIZE } });
    if (!received.ok) return received;
    items.push(...received.data.value);
    if (received.data.value.length < TEAM_MEMBER_PAGE_SIZE) return ok(items);
  }
  return adoErr('INTERNAL', `Listing ${path} needed more than ${DEFAULT_MAX_PAGES} pages; stopped.`, { kind: 'paging', method: 'GET', attempts: DEFAULT_MAX_PAGES });
}
