import type { AgentOutputEvent } from '@agent-lanes/contracts';

/** What an agent is doing to a file right now. `review` is how a reviewer's `read` or `edit` reads (see `deriveAgents`). */
export type AgentActivityKind = 'read' | 'edit' | 'review' | 'test' | 'idle';

/** The newest thing an agent did that names a file or a test run. */
export interface AgentActivityState {
  /** A worktree-relative path with forward slashes; null for a search or a test run, which name none. */
  readonly file: string | null;
  readonly kind: 'read' | 'edit' | 'test';
  readonly at: number;
}

const TEST_COMMAND =
  /\b(?:dotnet\s+test|vstest(?:\.console)?|nunit\S*|xunit\S*|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|vitest|e2e)\b|vitest|jest|mocha|pytest|playwright\s+test|go\s+test|cargo\s+test|mvn\s+(?:\S+\s+)*test|gradle\S*\s+test|ctest)\b/i;

/** Whether a Bash command looks like running tests. */
export function isTestCommand(command: string): boolean {
  return TEST_COMMAND.test(command);
}

function normalisePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

/**
 * Each agent's latest activity in an output stream (AL-278, handoff "Active file per agent"). The key is the
 * agent: the sub-agent's tool use id (`parentToolUseId`), else the ticket the event belongs to (the lead, or a
 * second agent on its own ticket). Read, Edit and Write name a file (`edit` and `write` are `edit`, `read` is
 * `read`); Grep and Glob are `read` with no file; a Bash command that runs tests is `test`. Any other tool leaves
 * the agent's activity as it was. The lead's `result` ends its turn and clears its activity; a sub-agent's is
 * cleared by `deriveAgents` once the sub-agent is done. Derived from the stream, so a restart replays it.
 */
export function deriveActivity(events: readonly AgentOutputEvent[]): ReadonlyMap<string, AgentActivityState> {
  const latest = new Map<string, AgentActivityState>();
  for (const { ticketId, at, item } of events) {
    const agentId = item.parentToolUseId ?? ticketId;
    if (item.kind === 'result') {
      if (item.parentToolUseId === null) latest.delete(ticketId);
      continue;
    }
    if (item.kind !== 'tool') continue;
    switch (item.tool) {
      case 'read':
        latest.set(agentId, { file: item.detail ? normalisePath(item.detail) : null, kind: 'read', at });
        break;
      case 'edit':
      case 'write':
        latest.set(agentId, { file: item.detail ? normalisePath(item.detail) : null, kind: 'edit', at });
        break;
      case 'grep':
      case 'glob':
        latest.set(agentId, { file: null, kind: 'read', at });
        break;
      case 'bash':
        if (isTestCommand(item.detail)) latest.set(agentId, { file: null, kind: 'test', at });
        break;
      default:
        break;
    }
  }
  return latest;
}
