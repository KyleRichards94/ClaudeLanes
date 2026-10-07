import { z } from 'zod';
import type { ClaudeConnectionSummary } from './connections.schemas';

/**
 * Claude connection (AL-044, design §7–§8, Q4): use the Claude Code login already on this computer,
 * or an API key that sessions get as `ANTHROPIC_API_KEY`. The main process finds the login by
 * starting Claude Code through the Agent SDK and reading its account, without sending a prompt.
 */

/**
 * What `connections:detectClaude` found. Account details only, never a credential: Claude Code
 * keeps its own login, and Agent Lanes neither reads nor stores it.
 */
export const ClaudeLoginDetectionSchema = z.object({
  /** Claude Code on this computer can make requests without an API key from Agent Lanes. */
  found: z.boolean(),
  /** How the modal names the login: `kyle@companionsystems.com.au (Companion Systems)`; null when none was found. */
  identity: z.string().nullable(),
  /** The claude.ai or Claude Console account's email address, when Claude Code knows it. */
  email: z.string().nullable(),
  organization: z.string().nullable(),
  /** The claude.ai plan (`pro`, `max`, `team`, `enterprise`) as Claude Code reports it; null when unknown. */
  plan: z.string().nullable(),
  /** Who Claude Code sends requests to: `Anthropic`, `Amazon Bedrock`, `Google Vertex AI`, …; null when unknown. */
  provider: z.string().nullable(),
  /** Why no login was found, or why looking failed, in words the modal can show; null when found. */
  message: z.string().nullable(),
  checkedAt: z.iso.datetime(),
});
export type ClaudeLoginDetection = z.infer<typeof ClaudeLoginDetectionSchema>;

/** The Claude tab's status line once the Claude Code login has passed its test (AL-044 acceptance criterion). */
export const CLAUDE_LOGIN_CONNECTED_TEXT = 'Connected · using your Claude Code login';

/**
 * One line for the Claude row in the Connections modal (AL-046 renders it):
 * - `Connected · using your Claude Code login` / `Connected · using an API key ••••••••Ab12` after a passing test;
 * - the test's error (`Anthropic refused this API key …`) while the status is `error`, so the row stays red;
 * - `Saved · not tested yet` before any test.
 */
export function claudeConnectionStatusLine(row: Pick<ClaudeConnectionSummary, 'mode' | 'status' | 'statusMessage' | 'maskedToken'>): string {
  switch (row.status) {
    case 'ok':
      return row.mode === 'login' ? CLAUDE_LOGIN_CONNECTED_TEXT : `Connected · using an API key${row.maskedToken ? ` ${row.maskedToken}` : ''}`;
    case 'error':
      return row.statusMessage ?? 'Not connected';
    case 'untested':
      return 'Saved · not tested yet';
  }
}
