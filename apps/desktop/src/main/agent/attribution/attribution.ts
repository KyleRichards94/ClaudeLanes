import type { AgentOutputEvent, AgentOutputItem } from '@agent-lanes/contracts';
import { actorOf, countLines, interleave, normaliseRelativePath, type TranscriptSource } from './transcript-sources';

/**
 * Agent attribution (AL-276, handoff "Agent attribution"): each changed file is credited to the agent
 * that wrote most of its lines, worked out from the Edit, MultiEdit and Write calls in the ticket's
 * transcripts, so no git blame is needed. Pure: the same events always give the same map, which is
 * how it is rebuilt after a restart (the transcript service reads the saved sessions back).
 *
 * An agent is the lead (its ticket id), a sub-agent (its Agent/Task tool use id; the credit stays with
 * it after its sub-branch merges) or a second agent (its own ticket id, AL-266).
 */
export interface FileAttribution {
  /** The agent with the most lines written; a tie goes to the one that edited the file first. */
  authorAgentId: string | null;
  /** Every agent that edited the file, first editor first. */
  touchedBy: string[];
}

/** Worktree-relative path (forward slashes) → who wrote it. A file with no entry was changed by you or a merge. */
export type AttributionMap = ReadonlyMap<string, FileAttribution>;

/** The file an Edit, MultiEdit or Write row changed. */
type EditItem = Extract<AgentOutputItem, { kind: 'tool' }>;

/** `+214 −0` → 214. */
function statsAdded(stats: string | null): number | null {
  const match = /^\+([\d,]+)/.exec(stats ?? '');
  return match ? Number(match[1]!.replaceAll(',', '')) : null;
}

/** MultiEdit and NotebookEdit rows carry their input as JSON instead of before/after text. */
function linesFromInput(input: string | null | undefined): number {
  if (!input) return 0;
  try {
    const data = JSON.parse(input) as { edits?: unknown; new_string?: unknown; new_source?: unknown };
    if (Array.isArray(data.edits)) {
      return data.edits.reduce<number>((sum, edit: { new_string?: unknown } | null) => sum + (typeof edit?.new_string === 'string' ? countLines(edit.new_string) : 0), 0);
    }
    const text = typeof data.new_string === 'string' ? data.new_string : data.new_source;
    return typeof text === 'string' ? countLines(text) : 0;
  } catch {
    // The input was clipped: the call still counts as an edit, with no lines credited.
    return 0;
  }
}

/** Lines of new text the call wrote: the new text of an Edit, the whole file of a Write. */
export function linesWritten(item: EditItem): number {
  if (item.tool === 'write') return statsAdded(item.stats) ?? countLines(item.edit?.after ?? '');
  if (item.edit) return countLines(item.edit.after);
  return linesFromInput(item.input);
}

interface Tally {
  /** Agent id → lines, in first-edit order. */
  lines: Map<string, number>;
}

/** Replays the sources' Edit, MultiEdit and Write calls; a call that failed writes nothing. */
export function replayAttribution(sources: readonly TranscriptSource[]): AttributionMap {
  const events = interleave(sources);
  const failed = new Set<string>();
  for (const { event } of events) {
    if (event.item.kind === 'tool-result' && event.item.isError) failed.add(event.item.toolUseId);
  }

  const counted = new Set<string>();
  const files = new Map<string, Tally>();
  for (const { source, event } of events) {
    const item = event.item;
    if (item.kind !== 'tool' || (item.tool !== 'edit' && item.tool !== 'write')) continue;
    // A row may arrive again (its sub-agent's spawn row grows, a history overlap): one call counts once.
    const callId = item.toolUseIds[0] ?? item.rowId;
    if (counted.has(callId) || failed.has(callId)) continue;
    const path = normaliseRelativePath(item.detail, source.cwd);
    if (path === null) continue;
    counted.add(callId);

    const tally = files.get(path) ?? { lines: new Map() };
    files.set(path, tally);
    const agent = actorOf(source, item.parentToolUseId);
    tally.lines.set(agent, (tally.lines.get(agent) ?? 0) + linesWritten(item));
  }

  const map = new Map<string, FileAttribution>();
  for (const [path, { lines }] of files) {
    let author: string | null = null;
    let best = -1;
    for (const [agent, count] of lines) {
      // Strictly more: on a tie the first editor, who comes first in the map, keeps it.
      if (count > best) {
        author = agent;
        best = count;
      }
    }
    map.set(path, { authorAgentId: author, touchedBy: [...lines.keys()] });
  }
  return map;
}

/** One source's events: a convenience for tests and callers with a single transcript. */
export function replayEvents(agentId: string, events: readonly AgentOutputEvent[], cwd?: string): AttributionMap {
  return replayAttribution([{ agentId, events, cwd }]);
}

/** A file's attribution by its path, then its old path (a rename); `null`s for a file with none. */
export function attributionOf(map: AttributionMap, path: string, oldPath: string | null = null): FileAttribution {
  const found = map.get(path) ?? (oldPath ? map.get(oldPath) : undefined) ?? foldedLookup(map, path) ?? (oldPath ? foldedLookup(map, oldPath) : undefined);
  return found ?? { authorAgentId: null, touchedBy: [] };
}

/** Windows paths differ in case between what an agent typed and what git lists. */
function foldedLookup(map: AttributionMap, path: string): FileAttribution | undefined {
  const folded = path.toLowerCase();
  for (const [key, value] of map) {
    if (key.toLowerCase() === folded) return value;
  }
  return undefined;
}
