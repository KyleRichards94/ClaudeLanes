import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The stand-in for the `claude` binary (`e2e/fixtures/fake-claude-code.mjs`); it never contacts anything. */
export const FAKE_CLAUDE = join(__dirname, '..', 'fixtures', 'fake-claude-code.mjs');

export interface FakeClaudeState {
  login?: { email: string; organization: string; subscriptionType: string } | null;
  apiKeys?: string[];
  log?: string;
  /** Claude Design access, and the artboards a design session answers with (AL-195). */
  design?: {
    artboards: { id: string; name: string; width: number | null; height: number | null }[];
    /** What the design thread's session answers each message with (AL-196); `{prompt}` is the message. */
    reply?: string;
  };
  /** What `supportedCommands()` lists (AL-114); empty by default. */
  commands?: { name: string; description: string; argumentHint: string; builtin?: boolean }[];
  /**
   * The ticket agent's script (AL-222): each user turn of a ticket session takes the first unused
   * turn whose `match` is in the prompt and runs its steps (see fixtures/fake-claude-code.mjs).
   */
  lead?: { turns: FakeAgentTurn[] };
}

export interface FakeAgentTurn {
  /** Text the prompt must contain; any prompt when left out. */
  match?: string;
  steps: FakeAgentStep[];
}

export type FakeAgentStep =
  /** Calls a tool of the app's `agent_lanes` server through the SDK and waits for its result. */
  | { tool: 'set_stage' | 'report_activity' | 'get_design_spec' | 'list_design_specs' | 'ack_design_spec'; input: Record<string, unknown> }
  /** Writes a file in the worktree and commits it. */
  | { commit: { file: string; content: string; message: string } }
  /** What the agent says at the end of the turn. */
  | { text: string };

export const FAKE_LOGIN = { email: 'kyle@example.com', organization: 'Example', subscriptionType: 'max' } as const;

/** Writes the fake's state file; a later write changes what the next `claude` start does. */
export function writeFakeClaudeState(file: string, state: FakeClaudeState): void {
  writeFileSync(file, JSON.stringify(state));
}

/** Env that makes the unpackaged app start the fake instead of the real `claude` binary. */
export function fakeClaudeEnv(stateFile: string): Record<string, string> {
  return { AGENT_LANES_CLAUDE_EXECUTABLE: FAKE_CLAUDE, AGENT_LANES_FAKE_CLAUDE_STATE: stateFile };
}
