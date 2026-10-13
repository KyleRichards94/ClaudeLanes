import type { ChangedFile } from '@agent-lanes/contracts';
import { authorOf, linesChanged, sortedByChange, UNKNOWN_AUTHOR_NAME } from '@/entities/diff-file';
import { UNKNOWN_AGENT_COLOR } from '@/shared/config';
import { mix } from '@/shared/lib';
import type { AgentView } from '@/entities/agent';
import { baseName } from '../lib/format';

/** The narrowest a tile gets, however few lines the file changed (handoff: `min-width: 24px`). */
export const TILE_MIN_WIDTH = 24;
export const TILE_HEIGHT = 44;
export const TILE_BAR_HEIGHT = 6;
/** Beyond this many files the map scrolls sideways. */
export const TILE_SCROLL_FROM = 40;

export const ADDED_COLOR = '#10B981';
export const REMOVED_COLOR = '#F87171';
/** The bar of a binary file: neither added nor removed lines to split it by. */
export const BINARY_BAR_COLOR = '#CBD5E1';

export interface ChangeTile {
  readonly path: string;
  /** The file name, shown on the tile. */
  readonly name: string;
  /** `flex-grow`: lines added plus removed (at least 1, so a file with no counted lines still shows). */
  readonly grow: number;
  /** The author's colour, and the tile's wash of it. */
  readonly authorColor: string;
  readonly tint: string;
  readonly authorName: string;
  /** Share of the bottom bar that is green and red, in percent; both 0 for a binary file. */
  readonly addedPercent: number;
  readonly removedPercent: number;
  readonly kind: ChangedFile['kind'];
  readonly renamed: boolean;
  readonly binary: boolean;
  readonly deleted: boolean;
  readonly added: number;
  readonly removed: number;
  /** Full path, +/−, author: the tooltip. */
  readonly tooltip: string;
  /** The tile's accessible name: "FailedSyncFiles.razor, 120 lines added, 0 removed, by Lead". */
  readonly label: string;
}

/** The share of the tile's bottom bar. A deleted file is all red, a binary file has none. */
export function barShares(file: Pick<ChangedFile, 'kind' | 'added' | 'removed'>): { addedPercent: number; removedPercent: number } {
  if (file.kind === 'binary') return { addedPercent: 0, removedPercent: 0 };
  if (file.kind === 'deleted') return { addedPercent: 0, removedPercent: 100 };
  const total = file.added + file.removed;
  if (total === 0) return { addedPercent: 0, removedPercent: 0 };
  const addedPercent = (file.added / total) * 100;
  return { addedPercent, removedPercent: 100 - addedPercent };
}

/** A file's tooltip: its full path, +/−, who wrote it. */
export function tileTooltip(file: ChangedFile, authorName: string): string {
  const where = file.kind === 'renamed' && file.oldPath ? `${file.path} (renamed from ${file.oldPath})` : file.path;
  const counts = file.kind === 'binary' ? 'binary file' : `+${file.added} −${file.removed}`;
  return `${where}\n${counts} · by ${authorName}`;
}

/** The tiles of the change map, largest change first, each with its width, tint and bar. */
export function changeTiles(files: readonly ChangedFile[], agents: readonly AgentView[]): ChangeTile[] {
  return sortedByChange(files).map((file): ChangeTile => {
    const author = authorOf(file, agents);
    const shares = barShares(file);
    const name = baseName(file.path);
    return {
      path: file.path,
      name,
      grow: Math.max(linesChanged(file), 1),
      authorColor: author.color,
      tint: mix(author.color, '#FFFFFF', 0.84),
      authorName: author.name,
      ...shares,
      kind: file.kind,
      renamed: file.kind === 'renamed',
      binary: file.kind === 'binary',
      deleted: file.kind === 'deleted',
      added: file.added,
      removed: file.removed,
      tooltip: tileTooltip(file, author.name),
      label: `${name}, ${file.kind === 'binary' ? 'binary file' : `${file.added} lines added, ${file.removed} removed`}, by ${author.name}${file.kind === 'deleted' ? ', deleted' : file.kind === 'renamed' ? ', renamed' : ''}`,
    };
  });
}

export interface LegendEntry {
  readonly key: string;
  readonly name: string;
  readonly color: string;
}

/**
 * The legend under the map: each agent that wrote a changed file, in the order the agents are listed, then the
 * grey "you or a merge" when some file has no recorded author. Colour is never alone: every entry carries its name.
 */
export function legendEntries(files: readonly ChangedFile[], agents: readonly AgentView[]): LegendEntry[] {
  const authors = new Set(files.map((file) => file.authorAgentId));
  const entries: LegendEntry[] = agents.filter((agent) => authors.has(agent.id)).map((agent) => ({ key: agent.id, name: agent.name, color: agent.color }));
  // An author the agents no longer list (an earlier agent) is grey too.
  const listed = new Set(agents.map((agent) => agent.id));
  if ([...authors].some((id) => id !== null && !listed.has(id))) entries.push({ key: 'earlier', name: 'An earlier agent', color: UNKNOWN_AGENT_COLOR });
  if (authors.has(null)) entries.push({ key: 'unknown', name: UNKNOWN_AUTHOR_NAME, color: UNKNOWN_AGENT_COLOR });
  return entries;
}

/** The file the diff shows: the selected one if it is still changed, else the one that changed most. */
export function shownFile(files: readonly ChangedFile[], selectedPath: string | null): ChangedFile | null {
  return files.find((file) => file.path === selectedPath) ?? sortedByChange(files)[0] ?? null;
}
