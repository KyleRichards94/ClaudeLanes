import { describe, expect, it } from 'vitest';
import { createClaudeLauncher } from '../agent/claude-sdk';
import { createFakeClaude, fakeAssistant, fakeErrorResult, fakeResult, type FakeClaudeScript } from '../agent/testing/fake-claude';
import { CLAUDE_TEST_MODEL, CLAUDE_TEST_PROMPT, CLAUDE_TEST_TIMEOUT_MESSAGE, createClaudeConnectionTester } from './claude-tester';

/** Made up for these tests; shaped like real keys, valid nowhere. */
const API_KEY = 'sk-ant-test-0000-not-a-real-key-0000-Ab12';
const INHERITED_KEY = 'sk-ant-inherited-0000-not-real-0000-Zz99';

const loginDraft = { kind: 'claude', mode: 'login' } as const;
const keyDraft = { kind: 'claude', mode: 'api-key', apiKey: API_KEY } as const;

const claudeAiLogin = {
  email: 'kyle@example.test',
  organization: 'Companion Systems',
  subscriptionType: 'team',
  tokenSource: 'claude.ai',
  apiKeySource: 'none',
  apiProvider: 'firstParty',
} as const;

/** What Claude Code answers when Anthropic refuses the key: an API-error assistant message, then an error result. */
const refusedKey: FakeClaudeScript = {
  account: { apiKeySource: 'ANTHROPIC_API_KEY', tokenSource: 'none', apiProvider: 'firstParty' },
  messages: [
    fakeAssistant('Invalid API key · Fix external API key', 'authentication_failed'),
    fakeResult({ is_error: true, result: 'Invalid API key · Fix external API key', api_error_status: 401 }),
  ],
};

function setup(script: FakeClaudeScript, executable: string | null = 'C:\\claude.exe') {
  const fake = createFakeClaude(script);
  const launcher = createClaudeLauncher({
    executable: () => executable,
    query: () => fake.query,
    baseEnv: () => ({ PATH: 'C:\\Windows', ANTHROPIC_API_KEY: INHERITED_KEY }),
  });
  return { fake, test: createClaudeConnectionTester(launcher) };
}

const signal = () => AbortSignal.timeout(5_000);

describe('Claude connection test', () => {
  it('makes one tiny request with the Claude Code login and reports the account', async () => {
    const { fake, test } = setup({ account: claudeAiLogin, messages: [fakeAssistant('OK'), fakeResult()] });

    expect(await test(loginDraft, signal())).toEqual({ status: 'ok', identity: 'kyle@example.test (Companion Systems)', message: null });

    const call = fake.calls[0];
    expect(call?.prompt).toBe(CLAUDE_TEST_PROMPT);
    expect(call?.options).toMatchObject({
      model: CLAUDE_TEST_MODEL,
      maxTurns: 1,
      tools: [],
      thinking: { type: 'disabled' },
      settingSources: [],
      persistSession: false,
      strictMcpConfig: true,
      pathToClaudeCodeExecutable: 'C:\\claude.exe',
    });
    expect(call?.options.systemPrompt).toEqual(expect.any(String));
    expect(JSON.stringify(call?.options.env)).not.toContain(INHERITED_KEY);
    expect(call?.closed).toBe(true);
  });

  it('passes the API key as ANTHROPIC_API_KEY and reports the organisation when Claude Code knows it', async () => {
    const { fake, test } = setup({
      account: { apiKeySource: 'ANTHROPIC_API_KEY', organization: 'Companion Systems', apiProvider: 'firstParty' },
      messages: [fakeAssistant('OK'), fakeResult()],
    });

    expect(await test(keyDraft, signal())).toEqual({ status: 'ok', identity: 'Companion Systems', message: null });
    expect(fake.calls[0]?.options.env?.['ANTHROPIC_API_KEY']).toBe(API_KEY);
  });

  it('reports no identity for a key whose account Claude Code does not know', async () => {
    const { test } = setup({ account: { apiKeySource: 'ANTHROPIC_API_KEY' }, messages: [fakeResult()] });
    expect(await test(keyDraft, signal())).toEqual({ status: 'ok', identity: null, message: null });
  });

  it('turns a refused API key into a clear error', async () => {
    const { fake, test } = setup(refusedKey);

    const outcome = await test(keyDraft, signal());

    expect(outcome).toEqual({
      status: 'error',
      identity: null,
      message: 'Anthropic refused this API key. Check that it was copied in full and is still active in the Claude Console, then test again.',
    });
    expect(JSON.stringify(outcome)).not.toContain(API_KEY);
    expect(fake.calls[0]?.closed).toBe(true);
  });

  it('recognises a refused key from the status or the text alone', async () => {
    for (const result of [fakeResult({ is_error: true, result: 'Request failed', api_error_status: 401 }), fakeResult({ is_error: true, result: 'Invalid API key · Fix external API key' })]) {
      const { test } = setup({ messages: [result] });
      expect(await test(keyDraft, signal())).toMatchObject({ status: 'error', message: expect.stringContaining('Anthropic refused this API key') });
    }
  });

  it('tells a signed-out or expired login how to sign in again', async () => {
    const { test } = setup({
      account: { tokenSource: 'none', apiKeySource: 'none' },
      messages: [fakeAssistant('Not logged in · Please run /login', 'authentication_failed'), fakeResult({ is_error: true, result: 'Not logged in · Please run /login' })],
    });
    expect(await test(loginDraft, signal())).toMatchObject({ status: 'error', message: expect.stringContaining('/login') });
  });

  it.each([
    ['billing_error', 'billing problem'],
    ['rate_limit', 'rate-limiting'],
    ['overloaded', "isn't answering properly"],
    ['oauth_org_not_allowed', "doesn't allow this Claude login"],
  ] as const)('explains %s', async (error, words) => {
    const { test } = setup({ messages: [fakeAssistant('API Error', error), fakeResult({ is_error: true, result: 'API Error' })] });
    expect(await test(keyDraft, signal())).toMatchObject({ status: 'error', message: expect.stringContaining(words) });
  });

  it('passes on what Claude answered when the error is not a known kind', async () => {
    const { test } = setup({ messages: [fakeResult({ is_error: true, result: 'API Error: 400 {"type":"invalid_request_error"}' })] });
    expect(await test(keyDraft, signal())).toMatchObject({ status: 'error', message: expect.stringContaining('invalid_request_error') });
  });

  it('counts a turn that ran out of turns as working', async () => {
    const { test } = setup({ account: claudeAiLogin, messages: [fakeErrorResult('error_max_turns')] });
    expect(await test(loginDraft, signal())).toMatchObject({ status: 'ok' });
  });

  it('explains a start-up refusal from managed settings', async () => {
    const { test } = setup({ messages: [fakeErrorResult('error_during_execution', { startup_failure_reason: 'org_pin_api_key_conflict', errors: ['x'] })] });
    expect(await test(keyDraft, signal())).toMatchObject({ status: 'error', message: expect.stringContaining("an API key can't be used") });
  });

  it('reports a run that failed with its errors', async () => {
    const { test } = setup({ messages: [fakeErrorResult('error_during_execution', { errors: ['Something broke'] })] });
    expect(await test(keyDraft, signal())).toMatchObject({ status: 'error', message: 'Claude Code stopped before answering: Something broke.' });
  });

  it('reports a process that ends without answering, with its last stderr line', async () => {
    const { test } = setup({ stderr: 'Loading…\nError: Claude Code could not reach api.anthropic.com\n', messages: [] });
    expect(await test(keyDraft, signal())).toMatchObject({
      status: 'error',
      message: 'Claude Code ended without answering the test: Error: Claude Code could not reach api.anthropic.com',
    });
  });

  it('reports a process that dies', async () => {
    const { test } = setup({ failWith: new Error('Claude Code process exited with code 1') });
    expect(await test(keyDraft, signal())).toMatchObject({ status: 'error', message: expect.stringContaining('exited with code 1') });
  });

  it('stops Claude Code and says so when the test runs out of time', async () => {
    const { fake, test } = setup({ hang: true });

    expect(await test(keyDraft, AbortSignal.timeout(20))).toEqual({ status: 'error', identity: null, message: CLAUDE_TEST_TIMEOUT_MESSAGE });
    expect(fake.calls[0]?.closed).toBe(true);
    expect(fake.calls[0]?.options.abortController?.signal.aborted).toBe(true);
  });

  it('does not start anything for a test that was already cancelled', async () => {
    const { fake, test } = setup({});
    const cancelled = new AbortController();
    cancelled.abort();
    expect(await test(keyDraft, cancelled.signal)).toMatchObject({ status: 'error', message: CLAUDE_TEST_TIMEOUT_MESSAGE });
    expect(fake.calls).toHaveLength(0);
  });

  it('says clearly when the claude binary is missing', async () => {
    const { test } = setup({}, null);
    expect(await test(loginDraft, signal())).toMatchObject({ status: 'error', message: expect.stringContaining("Claude Code isn't installed") });
  });
});
