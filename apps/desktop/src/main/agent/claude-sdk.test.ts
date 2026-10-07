import { describe, expect, it } from 'vitest';
import { ClaudeLaunchError, claudeProcessEnv, createClaudeLauncher, loadClaudeQuery } from './claude-sdk';
import { createFakeClaude } from './testing/fake-claude';

/** Made up for these tests; valid nowhere. */
const API_KEY = 'sk-ant-test-0000-not-a-real-key-0000-Ab12';
const INHERITED_KEY = 'sk-ant-inherited-0000-not-real-0000-Zz99';

const base = { PATH: 'C:\\Windows', USERPROFILE: 'C:\\Users\\kyle', HOME: undefined } satisfies NodeJS.ProcessEnv;

describe('claudeProcessEnv', () => {
  it('keeps the inherited environment, minus undefined values', () => {
    expect(claudeProcessEnv(base, { mode: 'login' })).toEqual({ PATH: 'C:\\Windows', USERPROFILE: 'C:\\Users\\kyle' });
  });

  it('drops an inherited API key for the Claude Code login, so the login is what Claude Code uses', () => {
    const env = claudeProcessEnv({ ...base, ANTHROPIC_API_KEY: INHERITED_KEY, anthropic_api_key: INHERITED_KEY }, { mode: 'login' });
    expect(JSON.stringify(env)).not.toContain(INHERITED_KEY);
  });

  it('keeps other setups (a gateway token, a cloud provider) for the login', () => {
    const env = claudeProcessEnv({ ...base, ANTHROPIC_AUTH_TOKEN: 'gateway', CLAUDE_CODE_USE_BEDROCK: '1' }, { mode: 'login' });
    expect(env).toMatchObject({ ANTHROPIC_AUTH_TOKEN: 'gateway', CLAUDE_CODE_USE_BEDROCK: '1' });
  });

  it('gives an API key connection its key and nothing Claude Code would prefer to it', () => {
    const env = claudeProcessEnv(
      { ...base, ANTHROPIC_API_KEY: INHERITED_KEY, ANTHROPIC_AUTH_TOKEN: 'gateway', CLAUDE_CODE_OAUTH_TOKEN: 'oauth' },
      { mode: 'api-key', apiKey: API_KEY },
    );
    expect(env['ANTHROPIC_API_KEY']).toBe(API_KEY);
    expect(env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN');
    expect(env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
    expect(JSON.stringify(env)).not.toContain(INHERITED_KEY);
  });

  it('names the app to the SDK when asked', () => {
    expect(claudeProcessEnv(base, { mode: 'login' }, 'agent-lanes/0.1.0')).toMatchObject({ CLAUDE_AGENT_SDK_CLIENT_APP: 'agent-lanes/0.1.0' });
  });

  it('does not change the environment it was given', () => {
    const inherited = { ...base, ANTHROPIC_API_KEY: INHERITED_KEY };
    claudeProcessEnv(inherited, { mode: 'api-key', apiKey: API_KEY });
    expect(inherited.ANTHROPIC_API_KEY).toBe(INHERITED_KEY);
  });
});

describe('createClaudeLauncher', () => {
  it('starts the resolved binary with the credential in its env', async () => {
    const fake = createFakeClaude({});
    const launcher = createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query, baseEnv: () => base, clientApp: 'agent-lanes/test' });

    await launcher.launch({ credential: { mode: 'api-key', apiKey: API_KEY }, prompt: 'hi', options: { maxTurns: 1 } });

    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.prompt).toBe('hi');
    expect(fake.calls[0]?.options).toMatchObject({
      maxTurns: 1,
      pathToClaudeCodeExecutable: 'C:\\claude.exe',
      env: { PATH: 'C:\\Windows', ANTHROPIC_API_KEY: API_KEY, CLAUDE_AGENT_SDK_CLIENT_APP: 'agent-lanes/test' },
    });
  });

  it('says clearly when the claude binary is missing', async () => {
    const fake = createFakeClaude({});
    const launcher = createClaudeLauncher({ executable: () => null, query: () => fake.query });

    const launching = launcher.launch({ credential: { mode: 'login' }, prompt: 'hi' });
    await expect(launching).rejects.toBeInstanceOf(ClaudeLaunchError);
    await expect(launching).rejects.toMatchObject({ code: 'NOT_INSTALLED', message: expect.stringContaining('Reinstall Agent Lanes') });
    expect(fake.calls).toHaveLength(0);
  });

  it("loads the installed SDK's query function (loading starts no process)", async () => {
    const query = await loadClaudeQuery();
    expect(typeof query).toBe('function');
    expect(await loadClaudeQuery()).toBe(query);
  });

  it('reports an SDK that fails to load without throwing anything else', async () => {
    const launcher = createClaudeLauncher({
      executable: () => 'C:\\claude.exe',
      query: () => Promise.reject(new Error('Cannot find module')),
    });

    await expect(launcher.launch({ credential: { mode: 'login' }, prompt: 'hi' })).rejects.toMatchObject({
      name: 'ClaudeLaunchError',
      code: 'SDK_UNAVAILABLE',
      message: expect.stringContaining('Cannot find module'),
    });
  });
});
