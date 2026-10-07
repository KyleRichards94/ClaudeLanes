import type { AccountInfo, SDKAssistantMessageError, SDKResultMessage, SDKStartupFailureReason } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeLaunchError, type ClaudeCredential, type ClaudeLauncher, type ClaudeQuery } from '../agent/claude-sdk';
import { checkProcessOptions, claudeAccountName, describeCause, describeClaudeLogin, stderrTail, within } from './claude-login';
import type { ConnectionTestOutcome, ConnectionTester } from './testers';

/**
 * Tests a Claude connection the way design §8 says, with a one-token request (AL-044): Claude Code
 * starts with the draft's credential (the Claude Code login, or the API key as `ANTHROPIC_API_KEY`),
 * answers a tiny prompt with one turn, no tools and no thinking, and reports the account and
 * organisation it used. A refused key or login comes back as a clear error for the row.
 */

/** The cheapest model. An alias, so it follows whichever Haiku the account can use. */
export const CLAUDE_TEST_MODEL = 'haiku';
export const CLAUDE_TEST_PROMPT = 'Reply with the single word OK.';
const CLAUDE_TEST_SYSTEM_PROMPT = 'This is a connection check from Agent Lanes. Reply with the single word OK and nothing else.';

export const CLAUDE_TEST_TIMEOUT_MESSAGE = "Claude didn't answer in time. Check this computer's network connection and test again.";

/** What failed, for the user: `this API key` or `your Claude Code login`. */
function subject(mode: ClaudeCredential['mode']): string {
  return mode === 'api-key' ? 'this API key' : 'your Claude Code login';
}

type ApiProblem = SDKAssistantMessageError | 'forbidden';

function apiProblemText(problem: ApiProblem, mode: ClaudeCredential['mode']): string | null {
  const what = subject(mode);
  switch (problem) {
    case 'authentication_failed':
      return mode === 'api-key'
        ? 'Anthropic refused this API key. Check that it was copied in full and is still active in the Claude Console, then test again.'
        : "Claude Code isn't signed in on this computer, or its login has expired. Sign in to Claude Code (run claude, then /login) and test again.";
    case 'forbidden':
      return `Anthropic refused the request: ${what} isn't allowed to use the Claude API.`;
    case 'oauth_org_not_allowed':
      return "Your organisation doesn't allow this Claude login to be used here. Ask an admin, or use an API key.";
    case 'account_on_hold':
      return `The Anthropic account behind ${what} is on hold.`;
    case 'verification_required':
      return `The Anthropic account behind ${what} has to be verified before it can be used.`;
    case 'billing_error':
      return `The Anthropic account behind ${what} has a billing problem, for example no credit left. Fix it and test again.`;
    case 'rate_limit':
      return `Anthropic is rate-limiting ${what} right now. Wait a minute and test again.`;
    case 'overloaded':
    case 'server_error':
      return "Anthropic's API isn't answering properly right now. Test again in a minute.";
    case 'model_not_found':
      return `${mode === 'api-key' ? 'This API key' : 'Your Claude Code login'} can't use Claude Haiku, the model the test asks.`;
    case 'cloud_credential_error':
      return "Claude Code's cloud provider credentials were refused.";
    case 'invalid_request':
    case 'max_output_tokens':
    case 'unknown':
      return null;
  }
}

function problemFromStatus(status: number | null | undefined): ApiProblem | undefined {
  if (status === 401) return 'authentication_failed';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limit';
  if (status === 529) return 'overloaded';
  if (status !== null && status !== undefined && status >= 500) return 'server_error';
  return undefined;
}

/** Claude Code's text for a refused credential ("Invalid API key · Fix external API key", "Please run /login"). */
const AUTH_FAILURE_TEXT = /invalid api key|invalid bearer|authentication|unauthori[sz]ed|not logged in|\/login|oauth token/i;

const STARTUP_FAILURE_TEXT: Partial<Record<SDKStartupFailureReason, string>> = {
  org_pin_api_key_conflict: "Your organisation's Claude Code settings require signing in with a Claude account, so an API key can't be used.",
  org_pin_mismatch: "This Claude login belongs to an organisation your organisation's Claude Code settings don't allow.",
  org_verify_failed: "Claude Code couldn't confirm which organisation this login belongs to. Check the network connection and test again.",
  provider_not_allowed: "Your organisation's Claude Code settings don't allow this way of reaching Claude.",
  cli_version_too_old: "The Claude Code inside this copy of Agent Lanes is older than your organisation allows. Update Agent Lanes.",
};

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** Null when the turn shows the credential works; otherwise what to tell the user. */
export function claudeTestProblem(result: SDKResultMessage, apiError: SDKAssistantMessageError | undefined, mode: ClaudeCredential['mode']): string | null {
  if (result.subtype === 'success') {
    if (!result.is_error) return null;
    const problem = apiError ?? problemFromStatus(result.api_error_status) ?? (AUTH_FAILURE_TEXT.test(result.result) ? 'authentication_failed' : undefined);
    // The model answered but ran out of room: the credential works.
    if (problem === 'max_output_tokens') return null;
    const known = problem ? apiProblemText(problem, mode) : null;
    return known ?? `Claude answered the test with an error: ${oneLine(result.result) || 'no details'}.`;
  }
  // One turn completed and the model wanted another: the credential works.
  if (result.subtype === 'error_max_turns') return null;
  const startup = result.startup_failure_reason ? STARTUP_FAILURE_TEXT[result.startup_failure_reason] : undefined;
  if (startup) return startup;
  const errors = oneLine(result.errors.join(' '));
  return `Claude Code stopped before answering${errors ? `: ${errors}` : ` (${result.subtype})`}.`;
}

/** Who the test ran as: the login's account, or the organisation an API key belongs to when Claude Code knows it. */
function testedIdentity(account: AccountInfo | undefined, mode: ClaudeCredential['mode']): string | null {
  if (!account) return null;
  if (mode === 'login') return describeClaudeLogin(account, new Date().toISOString()).identity;
  return claudeAccountName(account.email?.trim() || null, account.organization?.trim() || null);
}

export function createClaudeConnectionTester(launcher: ClaudeLauncher): ConnectionTester<'claude'> {
  return async (draft, signal) => {
    const credential: ClaudeCredential = draft.mode === 'api-key' && draft.apiKey !== undefined ? { mode: 'api-key', apiKey: draft.apiKey } : { mode: 'login' };
    const failed = (message: string): ConnectionTestOutcome => ({ status: 'error', identity: null, message });
    if (signal.aborted) return failed(CLAUDE_TEST_TIMEOUT_MESSAGE);

    const abortController = new AbortController();
    const stop = () => abortController.abort();
    signal.addEventListener('abort', stop, { once: true });
    const stderr = stderrTail();
    let query: ClaudeQuery | undefined;
    try {
      query = await launcher.launch({
        credential,
        prompt: CLAUDE_TEST_PROMPT,
        options: {
          ...checkProcessOptions(),
          model: CLAUDE_TEST_MODEL,
          maxTurns: 1,
          systemPrompt: CLAUDE_TEST_SYSTEM_PROMPT,
          thinking: { type: 'disabled' },
          abortController,
          stderr: stderr.add,
        },
      });
      const account = query.accountInfo().then(
        (info) => info,
        () => undefined,
      );

      let result: SDKResultMessage | undefined;
      let apiError: SDKAssistantMessageError | undefined;
      for await (const message of query) {
        if (message.type === 'assistant' && message.error) apiError = message.error;
        if (message.type === 'result') {
          result = message;
          break;
        }
      }
      if (!result) {
        if (signal.aborted) return failed(CLAUDE_TEST_TIMEOUT_MESSAGE);
        const detail = stderr.lastLine();
        return failed(`Claude Code ended without answering the test${detail ? `: ${detail}` : '.'}`);
      }

      const problem = claudeTestProblem(result, apiError, credential.mode);
      if (problem) return failed(problem);
      const info = await within(account, 5_000, 'Reading the account').catch(() => undefined);
      return { status: 'ok', identity: testedIdentity(info, credential.mode), message: null };
    } catch (cause) {
      if (signal.aborted) return failed(CLAUDE_TEST_TIMEOUT_MESSAGE);
      if (cause instanceof ClaudeLaunchError) return failed(cause.message);
      const detail = stderr.lastLine();
      return failed(`Claude Code stopped before answering the test: ${describeCause(cause)}${detail ? ` (${detail})` : ''}`);
    } finally {
      signal.removeEventListener('abort', stop);
      query?.close();
    }
  };
}
