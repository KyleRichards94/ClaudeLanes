import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { SDK_MODEL_IDS, err, ok, type NextActionsRequest, type NextActionsResponse, type Result } from '@agent-lanes/contracts';
import { z } from 'zod';
import type { ConnectionsService } from '../connections/service';
import { CLAUDE_CONNECTION_ID } from '../connections/service';
import type { Logger } from '../logging';
import type { ClaudeCredential, ClaudeLauncher } from './claude-sdk';
import { CLAUDE_KEY_UNREADABLE_MESSAGE, CLAUDE_NOT_CONNECTED_MESSAGE } from './session-manager';

/**
 * Next actions for the board digest (AL-272): one short Claude session, no tools, reads the digest
 * the renderer built and answers with one next step per ticket as JSON. Nothing is written anywhere;
 * the user sends a suggestion to a ticket's agent only by pressing "Send to agent".
 */
export interface NextActionsService {
  generate(request: NextActionsRequest): Promise<Result<NextActionsResponse>>;
}

export interface NextActionsOptions {
  claude: Pick<ClaudeLauncher, 'launch'>;
  connections: Pick<ConnectionsService, 'get' | 'secret'>;
  /** Where the session runs; it reads nothing there. */
  cwd: string;
  log?: Pick<Logger, 'warn'>;
  timeoutMs?: number;
}

export const NEXT_ACTIONS_MODEL = 'sonnet' as const;
export const NEXT_ACTIONS_TIMEOUT_MS = 90_000;

const OutputSchema = z.object({
  actions: z.array(z.object({ ticketId: z.string().min(1).max(200), text: z.string().min(1).max(1_000) })).max(200),
});

const OUTPUT_JSON_SCHEMA = {
  type: 'object',
  properties: {
    actions: {
      type: 'array',
      items: { type: 'object', properties: { ticketId: { type: 'string' }, text: { type: 'string' } }, required: ['ticketId', 'text'], additionalProperties: false },
    },
  },
  required: ['actions'],
  additionalProperties: false,
} as const;

export function nextActionsPrompt(digest: string): string {
  return [
    'You are helping a developer run several Claude Code agents from a board called Agent Lanes. Each line below is one agent ticket: its id, title, the stage its card is in, what the board noticed, and what the agent last did.',
    'For each ticket, suggest the single most useful next action for the developer or for the ticket\'s agent, in one plain sentence (under 30 words). Prefer: unblock what waits for the developer, bring back agents that stopped with work left, merge or open a PR for finished work, and leave working agents alone unless they have been quiet for hours.',
    'Reply with JSON only: {"actions":[{"ticketId":"<the id before the title, without the #>","text":"..."}]}. Use the ticket id exactly as given (digits for a work item, the whole id for pr-… tickets).',
    '',
    'The board:',
    digest,
  ].join('\n');
}

export function createNextActionsService(options: NextActionsOptions): NextActionsService {
  const timeoutMs = options.timeoutMs ?? NEXT_ACTIONS_TIMEOUT_MS;

  async function credential(): Promise<Result<ClaudeCredential>> {
    const summary = await options.connections.get(CLAUDE_CONNECTION_ID);
    if (summary?.kind !== 'claude') return err('VALIDATION', CLAUDE_NOT_CONNECTED_MESSAGE, { reason: 'claude-not-connected' });
    if (summary.mode === 'login') return ok({ mode: 'login' });
    const apiKey = await options.connections.secret(CLAUDE_CONNECTION_ID);
    if (apiKey === undefined) return err('VALIDATION', CLAUDE_KEY_UNREADABLE_MESSAGE, { reason: 'claude-key-unreadable' });
    return ok({ mode: 'api-key', apiKey });
  }

  return {
    async generate({ digest }) {
      const auth = await credential();
      if (!auth.ok) return auth;
      const abortController = new AbortController();
      const timer = setTimeout(() => abortController.abort(), timeoutMs);
      let query;
      try {
        query = await options.claude.launch({
          credential: auth.data,
          prompt: nextActionsPrompt(digest),
          options: {
            model: SDK_MODEL_IDS[NEXT_ACTIONS_MODEL],
            cwd: options.cwd,
            tools: [],
            outputFormat: { type: 'json_schema', schema: OUTPUT_JSON_SCHEMA },
            maxTurns: 1,
            persistSession: false,
            settingSources: [],
            abortController,
          },
        });
      } catch (cause) {
        clearTimeout(timer);
        return err('INTERNAL', `Couldn't start the session for next actions: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
      try {
        for await (const message of query as AsyncIterable<SDKMessage>) {
          if (message.type !== 'result') continue;
          if (message.subtype !== 'success' || message.is_error) {
            const detail = message.subtype === 'success' ? message.result : message.subtype;
            return err('INTERNAL', `Next actions did not come back (${detail}).`);
          }
          const parsed = OutputSchema.safeParse(message.structured_output);
          if (!parsed.success) {
            options.log?.warn(`Next actions came back in an unexpected shape: ${parsed.error.issues[0]?.message ?? ''}`);
            return err('INTERNAL', 'Next actions came back in an unexpected shape.');
          }
          return ok({ model: NEXT_ACTIONS_MODEL, actions: parsed.data.actions });
        }
        return err('INTERNAL', abortController.signal.aborted ? 'Next actions took too long.' : 'The session ended without an answer.');
      } catch (cause) {
        return err('INTERNAL', `Couldn't get next actions: ${cause instanceof Error ? cause.message : String(cause)}`);
      } finally {
        clearTimeout(timer);
        query.close();
      }
    },
  };
}
