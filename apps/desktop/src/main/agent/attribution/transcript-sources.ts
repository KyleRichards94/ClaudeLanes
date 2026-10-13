import { posix } from 'node:path';
import type { AgentOutputEvent } from '@agent-lanes/contracts';

/**
 * What attribution (AL-276) and review findings (AL-277) replay: one transcript per agent session of
 * a ticket, the lead's and each second agent's (AL-266). The same helpers serve both, so a path or an
 * agent id means the same in `diff:files` and `review:findings`.
 */
export interface TranscriptSource {
  /** The ticket id the transcript belongs to: the lead's, or a second agent's own. It names the agent that wrote output with no `parentToolUseId`. */
  agentId: string;
  /** Oldest first, as `agent:getTranscript` returns them. */
  events: readonly AgentOutputEvent[];
  /** The worktree the agent works in, to make absolute paths relative. */
  cwd?: string;
}

/** The agent an output item belongs to: a sub-agent by its Agent/Task tool use id, else the session's own agent. */
export function actorOf(source: Pick<TranscriptSource, 'agentId'>, parentToolUseId: string | null): string {
  return parentToolUseId ?? source.agentId;
}

/**
 * Every source's events in time order. Each transcript keeps its own order (`at` never goes down
 * inside one); history read back after a restart has `at` 0, so it sorts before live output.
 */
export function interleave<S extends Pick<TranscriptSource, 'events'>>(sources: readonly S[]): Array<{ source: S; event: AgentOutputEvent }> {
  const all = sources.flatMap((source) => source.events.map((event) => ({ source, event })));
  // Array.prototype.sort is stable, so equal times keep source and transcript order.
  return sources.length > 1 ? all.sort((a, b) => a.event.at - b.event.at) : all;
}

/**
 * A worktree-relative path with forward slashes and no `./`, or null for an empty one or one outside
 * the worktree. An absolute path inside `cwd` is made relative to it.
 */
export function normaliseRelativePath(raw: string, cwd?: string): string | null {
  let path = raw.trim().replaceAll('\\', '/');
  if (cwd) {
    const root = cwd.replaceAll('\\', '/').replace(/\/+$/, '');
    if (root !== '' && path.toLowerCase().startsWith(`${root.toLowerCase()}/`)) path = path.slice(root.length + 1);
  }
  if (path === '' || path.startsWith('/') || /^[a-zA-Z]:/.test(path) || path.includes('\0')) return null;
  const normalised = posix.normalize(path);
  if (normalised === '.' || normalised === '..' || normalised.startsWith('../')) return null;
  return normalised;
}

/** Lines in a text: none for an empty one, and a final newline does not start another line. */
export function countLines(text: string): number {
  if (text === '') return 0;
  const lines = text.split(/\r?\n/);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}
