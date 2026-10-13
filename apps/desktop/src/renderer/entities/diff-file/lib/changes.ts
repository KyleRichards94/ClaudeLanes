import type { ChangedFile } from '@agent-lanes/contracts';
import { UNKNOWN_AGENT_COLOR } from '@/shared/config';

/** An agent as far as crediting a file goes; `entities/agent`'s `AgentView` has all three. */
export interface AuthorAgent {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

/** Who a file is credited to, ready to draw: the stripe, the tile tint and "by {name}". */
export interface FileAuthor {
  /** The credited agent; null for a file nobody recorded an edit for (you, or a merge). */
  readonly agentId: string | null;
  readonly name: string;
  readonly color: string;
}

/** The author line of a file nobody recorded an edit for (handoff "Agent attribution" step 4). */
export const UNKNOWN_AUTHOR_NAME = 'you or a merge';

/**
 * The agent a file is credited to (the one that wrote most of its lines), with its colour. A file with no
 * recorded author, or whose author is not among `agents`, is neutral grey `#94A3B8`.
 */
export function authorOf(file: Pick<ChangedFile, 'authorAgentId'>, agents: readonly AuthorAgent[]): FileAuthor {
  if (file.authorAgentId === null) return { agentId: null, name: UNKNOWN_AUTHOR_NAME, color: UNKNOWN_AGENT_COLOR };
  const agent = agents.find((candidate) => candidate.id === file.authorAgentId);
  return agent
    ? { agentId: agent.id, name: agent.name, color: agent.color }
    : { agentId: file.authorAgentId, name: 'an earlier agent', color: UNKNOWN_AGENT_COLOR };
}

/** Lines the file changed: what the change map's tile width and the city's ordering go by. */
export function linesChanged(file: Pick<ChangedFile, 'added' | 'removed'>): number {
  return file.added + file.removed;
}

/** Largest change first, then by path, as the change map lays its tiles out. */
export function sortedByChange(files: readonly ChangedFile[]): ChangedFile[] {
  return [...files].sort((a, b) => linesChanged(b) - linesChanged(a) || a.path.localeCompare(b.path));
}

export interface ChangeTotals {
  readonly files: number;
  readonly added: number;
  readonly removed: number;
}

/** "12 files · +214 −8" in numbers. */
export function changeTotals(files: readonly ChangedFile[]): ChangeTotals {
  return files.reduce<ChangeTotals>((sum, file) => ({ files: sum.files + 1, added: sum.added + file.added, removed: sum.removed + file.removed }), { files: 0, added: 0, removed: 0 });
}

/** The agents that edited a file other than its author, for the tooltip ("also touched by …"). */
export function coAuthorsOf(file: Pick<ChangedFile, 'authorAgentId' | 'touchedBy'>): string[] {
  return file.touchedBy.filter((id) => id !== file.authorAgentId);
}
