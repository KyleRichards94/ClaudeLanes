import type { BacklogFilters, BacklogItem, BacklogPage, Lane, TeamBoardPerson } from '@agent-lanes/contracts';
import { LANE_LABELS, dragLock, type BacklogItemCard, type DropMe } from '@/entities/agent-ticket';
import type { LaneDragData } from '@/features/drag-to-lane';
import type { BacklogSearch } from './session';

/** Who "me" is: the identity the Connections token test returned (TB§6 Identity). */
export interface BacklogMe {
  displayName: string;
}

export type BacklogTypeTone = 'ado' | 'danger' | 'neutral';

/** One backlog row (artboard 11): grip, checkbox, `#71360`, Story, title, tag, "5 pts", priority 1. */
export interface BacklogRowView {
  id: number;
  idLabel: string;
  /** "Story", "Bug", "Task", or ADO's own name for other types. */
  type: string;
  typeTone: BacklogTypeTone;
  title: string;
  /** The first tag ("jobs"), or null. */
  tag: string | null;
  /** "5 pts", or null when not estimated. */
  points: string | null;
  priority: number | null;
  /** "Assigned to Mark Davies" on someone else's item: not draggable (T7). */
  lock: string | null;
  /** "Agent in Planning" once an agent works on it (TB§5: the row stays, tagged). */
  agentTag: string | null;
  /** Already in a sprint (shown only with the "in a sprint" toggle on). */
  inSprint: boolean;
  /** What dragging it carries; null when it can't be dragged. */
  drag: LaneDragData | null;
  webUrl: string;
}

/** Rows under one Feature ("Job management 3"). */
export interface BacklogGroupView {
  key: string;
  title: string;
  rows: readonly BacklogRowView[];
}

/** The filters as `ado:backlog` takes them (AL-233); blank ones are left out. */
export function backlogFilters(search: BacklogSearch): BacklogFilters {
  const text = search.text.trim();
  return {
    ...(search.kind === 'all' ? {} : { kinds: [search.kind] }),
    ...(search.priority === null ? {} : { priorities: [search.priority] }),
    ...(search.area === null ? {} : { areas: [search.area] }),
    ...(search.tag === null ? {} : { tags: [search.tag] }),
    ...(text ? { text } : {}),
    ...(search.includeInSprint ? { includeInSprint: true } : {}),
  };
}

const TYPE_NAMES: Readonly<Record<BacklogItem['kind'], { name: string | null; tone: BacklogTypeTone }>> = {
  story: { name: 'Story', tone: 'ado' },
  bug: { name: 'Bug', tone: 'danger' },
  task: { name: 'Task', tone: 'neutral' },
  other: { name: null, tone: 'neutral' },
};

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

/** The person is the signed-in user, by display or sign-in name (the token test returns the display name). */
function isMine(person: TeamBoardPerson | null, me: BacklogMe | null): boolean {
  if (!person || !me) return false;
  return sameName(person.displayName, me.displayName) || sameName(person.uniqueName, me.displayName);
}

/** The drop rules (AL-230) key "me" by identity id; the backlog knows the user by name, so a match is marked with this id. */
const ME_ID = 'agent-lanes:me';
const DROP_ME: DropMe = { id: ME_ID };

export function rowView(item: BacklogItem, me: BacklogMe | null, agentLane: Lane | null): BacklogRowView {
  const card: BacklogItemCard = {
    kind: 'backlog-item',
    id: item.id,
    assignee: item.assignee ? (isMine(item.assignee, me) ? { id: ME_ID, displayName: item.assignee.displayName } : { id: item.assignee.id ?? null, displayName: item.assignee.displayName }) : null,
    agentLane,
  };
  const reason = dragLock(card, DROP_ME);
  const type = TYPE_NAMES[item.kind];
  return {
    id: item.id,
    idLabel: `#${item.id}`,
    type: type.name ?? item.type,
    typeTone: type.tone,
    title: item.title,
    tag: item.tags[0] ?? null,
    points: item.points === null ? null : `${item.points} pts`,
    priority: item.priority,
    lock: reason !== null && reason.startsWith('Assigned to') ? reason : null,
    agentTag: agentLane ? `Agent in ${LANE_LABELS[agentLane]}` : null,
    inSprint: item.inSprint,
    drag:
      reason === null
        ? {
            key: `backlog:${item.id}`,
            label: `#${item.id}`,
            title: item.title,
            card,
            me: DROP_ME,
            meName: me?.displayName ?? null,
            source: { kind: 'backlog-item', id: item.id },
          }
        : null,
    webUrl: item.webUrl,
  };
}

/**
 * The loaded pages as one list of Feature groups in backlog order. A Feature that runs over a page
 * boundary comes back on both pages (D600); its two halves are joined here.
 */
export function backlogGroups(pages: readonly BacklogPage[], me: BacklogMe | null, workItemLanes: Readonly<Record<string, Lane>>): BacklogGroupView[] {
  const groups: BacklogGroupView[] = [];
  let lastFeature: number | null | undefined;
  for (const page of pages) {
    for (const group of page.groups) {
      const featureId = group.feature?.id ?? null;
      const rows = group.items.map((item) => rowView(item, me, workItemLanes[String(item.id)] ?? null));
      const last = groups.at(-1);
      if (last && lastFeature === featureId) {
        groups[groups.length - 1] = { ...last, rows: [...last.rows, ...rows] };
      } else {
        groups.push({ key: featureId === null ? `none-${groups.length}` : `feature-${featureId}-${groups.length}`, title: group.feature?.title ?? 'No feature', rows });
      }
      lastFeature = featureId;
    }
  }
  return groups;
}

/** Every row, top to bottom: the order shift-click selects a range in. */
export function rowOrder(groups: readonly BacklogGroupView[]): number[] {
  return groups.flatMap((group) => group.rows.map((row) => row.id));
}

/**
 * The selection after a click on a row (TB§5 multi-select): a plain click adds or removes the row; a
 * shift-click adds every row from the last one clicked to this one.
 */
export function clickSelection(input: { selected: readonly number[]; order: readonly number[]; anchor: number | null; id: number; shift: boolean }): number[] {
  const { selected, order, anchor, id, shift } = input;
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const to = order.indexOf(id);
  if (shift && from >= 0 && to >= 0) {
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    return order.filter((candidate) => selected.includes(candidate) || range.includes(candidate));
  }
  return selected.includes(id) ? selected.filter((candidate) => candidate !== id) : order.filter((candidate) => candidate === id || selected.includes(candidate));
}

/**
 * The row's drag: a selected row carries every selected row that can be dragged, in list order, so
 * dropping it starts one agent each (TB§5); any other row carries itself.
 */
export function rowDrag(row: BacklogRowView, selectedRows: readonly BacklogRowView[]): LaneDragData | null {
  if (!row.drag) return null;
  const group = selectedRows.flatMap((candidate) => (candidate.drag ? [candidate.drag] : []));
  if (group.length < 2 || !group.some((member) => member.key === row.drag?.key)) return row.drag;
  return { ...row.drag, group };
}

/** "Portal" for `OnSite Companion\OSC\Portal`: the area's last level. */
export function areaLabel(path: string): string {
  return path.split('\\').filter(Boolean).at(-1) ?? path;
}

/** The areas and tags seen on the loaded rows, for the Area and Tag menus, sorted. */
export function filterChoices(pages: readonly BacklogPage[]): { areas: string[]; tags: string[] } {
  const areas = new Set<string>();
  const tags = new Set<string>();
  for (const page of pages) {
    for (const group of page.groups) {
      for (const item of group.items) {
        areas.add(item.areaPath);
        for (const tag of item.tags) tags.add(tag);
      }
    }
  }
  const sort = (values: Set<string>) => [...values].sort((a, b) => a.localeCompare(b));
  return { areas: sort(areas), tags: sort(tags) };
}
