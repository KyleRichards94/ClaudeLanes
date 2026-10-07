import { ClaudeLoginDetectionSchema } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { createClaudeLauncher } from '../agent/claude-sdk';
import { createFakeClaude, type FakeClaudeScript } from '../agent/testing/fake-claude';
import { NO_CLAUDE_LOGIN_MESSAGE, createClaudeLoginDetector, describeClaudeLogin } from './claude-login';

const AT = '2026-10-07T03:00:00.000Z';
const INHERITED_KEY = 'sk-ant-inherited-0000-not-real-0000-Zz99';

/** What Claude Code reports for a claude.ai login (the shape `accountInfo()` has in SDK 0.3.292). */
const claudeAiLogin = {
  email: 'kyle@example.test',
  organization: 'Companion Systems',
  subscriptionType: 'team',
  tokenSource: 'claude.ai',
  apiKeySource: 'none',
  apiProvider: 'firstParty',
} as const;

function setup(script: FakeClaudeScript, options: { timeoutMs?: number; executable?: string | null } = {}) {
  const fake = createFakeClaude(script);
  const launcher = createClaudeLauncher({
    executable: () => (options.executable === undefined ? 'C:\\claude.exe' : options.executable),
    query: () => fake.query,
    baseEnv: () => ({ PATH: 'C:\\Windows', ANTHROPIC_API_KEY: INHERITED_KEY }),
  });
  const detect = createClaudeLoginDetector(launcher, { now: () => new Date(AT), timeoutMs: options.timeoutMs ?? 1_000 });
  return { fake, detect };
}

describe('describeClaudeLogin', () => {
  it('finds a claude.ai login and names its account and organisation', () => {
    expect(describeClaudeLogin(claudeAiLogin, AT)).toEqual({
      found: true,
      identity: 'kyle@example.test (Companion Systems)',
      email: 'kyle@example.test',
      organization: 'Companion Systems',
      plan: 'team',
      provider: 'Anthropic',
      message: null,
      checkedAt: AT,
    });
  });

  it('counts the key /login makes for a Claude Console account as a login', () => {
    expect(describeClaudeLogin({ email: 'kyle@example.test', apiKeySource: '/login managed key', tokenSource: 'none' }, AT)).toMatchObject({
      found: true,
      identity: 'kyle@example.test',
    });
  });

  it('counts Claude Code set up for a cloud provider as a login', () => {
    expect(describeClaudeLogin({ apiProvider: 'bedrock' }, AT)).toMatchObject({ found: true, provider: 'Amazon Bedrock', identity: 'Claude Code via Amazon Bedrock' });
  });

  it('finds nothing when Claude Code has no credential', () => {
    for (const account of [{ tokenSource: 'none', apiKeySource: 'none', apiProvider: 'firstParty' as const }, {}, undefined]) {
      expect(describeClaudeLogin(account, AT)).toEqual({
        found: false,
        identity: null,
        email: null,
        organization: null,
        plan: null,
        provider: 'Anthropic',
        message: NO_CLAUDE_LOGIN_MESSAGE,
        checkedAt: AT,
      });
    }
  });

  it("doesn't take an API key from the environment for a login", () => {
    expect(describeClaudeLogin({ apiKeySource: 'ANTHROPIC_API_KEY', tokenSource: 'none' }, AT)).toMatchObject({ found: false });
  });

  it('always fits the IPC contract', () => {
    expect(ClaudeLoginDetectionSchema.safeParse(describeClaudeLogin(claudeAiLogin, AT)).success).toBe(true);
    expect(ClaudeLoginDetectionSchema.safeParse(describeClaudeLogin(undefined, AT)).success).toBe(true);
  });
});

describe('createClaudeLoginDetector', () => {
  it('starts Claude Code without an API key, reads the account, sends no prompt and stops it', async () => {
    const { fake, detect } = setup({ account: claudeAiLogin, hang: true });

    expect(await detect()).toMatchObject({ found: true, identity: 'kyle@example.test (Companion Systems)' });

    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0];
    expect(call?.prompt).toBeUndefined();
    expect(call?.sent).toEqual([]);
    expect(call?.closed).toBe(true);
    // The user chose their login: a key inherited from the environment would win over it.
    expect(JSON.stringify(call?.options.env)).not.toContain(INHERITED_KEY);
    expect(call?.options).toMatchObject({
      pathToClaudeCodeExecutable: 'C:\\claude.exe',
      settingSources: [],
      persistSession: false,
      tools: [],
      strictMcpConfig: true,
      mcpServers: {},
    });
  });

  it('reports no login when Claude Code has none', async () => {
    const { detect } = setup({ account: { tokenSource: 'none', apiKeySource: 'none', apiProvider: 'firstParty' } });
    expect(await detect()).toMatchObject({ found: false, message: NO_CLAUDE_LOGIN_MESSAGE });
  });

  it('shares one check between callers while it runs', async () => {
    const { fake, detect } = setup({ account: claudeAiLogin });
    const [first, second] = await Promise.all([detect(), detect()]);
    expect(first).toEqual(second);
    expect(fake.calls).toHaveLength(1);

    await detect();
    expect(fake.calls).toHaveLength(2);
  });

  it('gives up on a Claude Code that never starts, and stops it', async () => {
    const { fake, detect } = setup({ account: 'hang', stderr: 'starting…\nError: something went wrong\n' }, { timeoutMs: 20 });

    const result = await detect();

    expect(result).toMatchObject({ found: false, identity: null });
    expect(result.message).toContain('took longer than');
    expect(result.message).toContain('Error: something went wrong');
    expect(fake.calls[0]?.closed).toBe(true);
  });

  it('reports a process that fails to start', async () => {
    const { detect } = setup({ account: new Error('spawn ENOENT') });
    expect(await detect()).toMatchObject({ found: false, message: expect.stringContaining('spawn ENOENT') });
  });

  it('reports a missing claude binary without throwing', async () => {
    const { fake, detect } = setup({}, { executable: null });
    expect(await detect()).toMatchObject({ found: false, message: expect.stringContaining("Claude Code isn't installed") });
    expect(fake.calls).toHaveLength(0);
  });
});
