import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CLAUDE_LOGIN_CONNECTED_TEXT, claudeConnectionStatusLine, type ClaudeConnectionSummary, type ConnectionSummary } from '@agent-lanes/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClaudeLauncher } from '../agent/claude-sdk';
import { createFakeClaude, fakeAssistant, fakeResult, type FakeClaudeCall, type FakeClaudeScript } from '../agent/testing/fake-claude';
import { handleInvoke } from '../ipc/handle-invoke';
import { SECRETS_FILE_NAME, createSecretStore } from '../secrets';
import { createFakeSafeStorage } from '../secrets/testing';
import { createClaudeLoginDetector } from './claude-login';
import { createClaudeConnectionTester } from './claude-tester';
import { createMemoryConnectionsFile, type MemoryConnectionsFile } from './connections-file';
import { createConnectionsHandlers } from './handlers';
import { createConnectionsService } from './service';

/**
 * AL-044 through the connections service and its IPC handlers, with the Agent SDK faked: what the
 * Claude tab gets for a machine with a Claude Code login, and for a wrong API key.
 */

/** Made up for these tests; shaped like real keys, valid nowhere. */
const GOOD_KEY = 'sk-ant-test-1111-not-a-real-key-1111-Gd34';
const BAD_KEY = 'sk-ant-test-0000-not-a-real-key-0000-Ab12';

const claudeAiLogin = {
  email: 'kyle@example.test',
  organization: 'Companion Systems',
  subscriptionType: 'team',
  tokenSource: 'claude.ai',
  apiKeySource: 'none',
  apiProvider: 'firstParty',
} as const;

/** A fake Claude Code: signed in to claude.ai when `loggedIn`, and accepting only GOOD_KEY. */
function fakeMachine(state: { loggedIn: boolean }) {
  return (call: FakeClaudeCall): FakeClaudeScript => {
    const key = call.options.env?.['ANTHROPIC_API_KEY'];
    const accepted = key === undefined ? state.loggedIn : key === GOOD_KEY;
    const account = key !== undefined ? { apiKeySource: 'ANTHROPIC_API_KEY', tokenSource: 'none' } : state.loggedIn ? claudeAiLogin : { tokenSource: 'none', apiKeySource: 'none' };
    if (call.prompt === undefined) return { account, hang: true };
    const refusal = key !== undefined ? 'Invalid API key · Fix external API key' : 'Not logged in · Please run /login';
    return {
      account,
      messages: accepted
        ? [fakeAssistant('OK'), fakeResult()]
        : [fakeAssistant(refusal, 'authentication_failed'), fakeResult({ is_error: true, result: refusal, api_error_status: 401 })],
    };
  };
}

let dir: string;
let key: Buffer;
let file: MemoryConnectionsFile;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-lanes-claude-connection-'));
  key = randomBytes(32);
  file = createMemoryConnectionsFile();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function start(state: { loggedIn: boolean }) {
  const fake = createFakeClaude(fakeMachine(state));
  const launcher = createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query, baseEnv: () => ({ PATH: 'C:\\Windows' }) });
  const service = createConnectionsService({
    file,
    secrets: createSecretStore({ filePath: join(dir, SECRETS_FILE_NAME), safeStorage: createFakeSafeStorage({ key }), warn: () => undefined }),
    emit: () => undefined,
    testers: { claude: createClaudeConnectionTester(launcher) },
    detectClaudeLogin: createClaudeLoginDetector(launcher),
    warn: () => undefined,
  });
  const handlers = createConnectionsHandlers(service);
  const replies: unknown[] = [];
  async function call<C extends keyof typeof handlers>(channel: C, request?: unknown) {
    const reply = await handleInvoke(channel, request, handlers[channel]);
    replies.push(reply);
    if (!reply.ok) throw new Error(`${channel}: ${reply.code} ${reply.message}`);
    return reply.data;
  }
  return { fake, service, call, replies };
}

function claudeRow(rows: ConnectionSummary[]): ClaudeConnectionSummary {
  const row = rows.find((item) => item.kind === 'claude');
  if (row?.kind !== 'claude') throw new Error('no Claude row');
  return row;
}

describe('Claude connection (AL-044)', () => {
  it('with a Claude Code login on the machine, connects with no key entered', async () => {
    const { fake, call } = start({ loggedIn: true });

    // The Claude tab looks for a login and offers "Use my Claude Code login".
    expect(await call('connections:detectClaude')).toMatchObject({ found: true, identity: 'kyle@example.test (Companion Systems)', plan: 'team' });
    // Looking sends no prompt.
    expect(fake.calls[0]).toMatchObject({ prompt: undefined, sent: [], closed: true });

    // The user takes it: Test (one tiny request), then Save. No key anywhere.
    expect(await call('connections:test', { draft: { kind: 'claude', mode: 'login' } })).toMatchObject({
      status: 'ok',
      identity: 'kyle@example.test (Companion Systems)',
    });
    const saved = await call('connections:save', { kind: 'claude', mode: 'login' });
    expect(saved).toMatchObject({ id: 'claude', kind: 'claude', mode: 'login', status: 'ok', maskedToken: null, identity: 'kyle@example.test (Companion Systems)' });

    const row = claudeRow(await call('connections:list'));
    expect(claudeConnectionStatusLine(row)).toBe(CLAUDE_LOGIN_CONNECTED_TEXT);
    expect(claudeConnectionStatusLine(row)).toBe('Connected · using your Claude Code login');
    for (const started of fake.calls) expect(started.options.env).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('says when no Claude Code login was found', async () => {
    const { call } = start({ loggedIn: false });
    expect(await call('connections:detectClaude')).toMatchObject({ found: false, identity: null, message: expect.stringContaining('/login') });
    expect(await call('connections:test', { draft: { kind: 'claude', mode: 'login' } })).toMatchObject({
      status: 'error',
      message: expect.stringContaining("Claude Code isn't signed in"),
    });
  });

  it('an invalid API key shows a clear error and stays red', async () => {
    const { service, call, replies } = start({ loggedIn: false });
    const draft = { kind: 'claude', mode: 'api-key', apiKey: BAD_KEY } as const;

    const tested = await call('connections:test', { draft });
    expect(tested).toMatchObject({ status: 'error', identity: null, message: expect.stringContaining('Anthropic refused this API key') });

    // Saving the key that failed keeps the failure on the row.
    const saved = await call('connections:save', draft);
    expect(saved).toMatchObject({ status: 'error', statusMessage: tested.message, maskedToken: '••••••••Ab12' });
    expect(claudeConnectionStatusLine(claudeRow(await call('connections:list')))).toContain('Anthropic refused this API key');

    // Testing it again, and starting again, keep it red.
    expect(await call('connections:test', { id: 'claude' })).toMatchObject({ status: 'error' });
    expect(claudeRow(await call('connections:list'))).toMatchObject({ status: 'error', statusMessage: tested.message });
    const restarted = createConnectionsService({
      file,
      secrets: createSecretStore({ filePath: join(dir, SECRETS_FILE_NAME), safeStorage: createFakeSafeStorage({ key }), warn: () => undefined }),
      emit: () => undefined,
      warn: () => undefined,
    });
    expect(claudeRow(await restarted.list())).toMatchObject({ status: 'error', statusMessage: tested.message });

    // Replacing it with a good key turns it green.
    expect(await call('connections:replace', { id: 'claude', draft: { ...draft, apiKey: GOOD_KEY } })).toMatchObject({ status: 'untested' });
    expect(await call('connections:test', { id: 'claude' })).toMatchObject({ status: 'ok' });
    expect(claudeConnectionStatusLine(claudeRow(await service.list()))).toBe('Connected · using an API key ••••••••Gd34');

    const sent = JSON.stringify(replies);
    expect(sent).not.toContain(BAD_KEY);
    expect(sent).not.toContain(GOOD_KEY);
  });

  it('runs no Claude Code until asked', () => {
    const { fake } = start({ loggedIn: true });
    expect(fake.calls).toEqual([]);
  });

  it('says when looking for a login is not available', async () => {
    const service = createConnectionsService({
      file,
      secrets: createSecretStore({ filePath: join(dir, SECRETS_FILE_NAME), safeStorage: createFakeSafeStorage({ key }), warn: () => undefined }),
      emit: () => undefined,
      warn: () => undefined,
    });
    expect(await service.detectClaudeLogin()).toMatchObject({ ok: false, code: 'INTERNAL' });
  });

  it('reports a detector that throws as an error, not a crash', async () => {
    const service = createConnectionsService({
      file,
      secrets: createSecretStore({ filePath: join(dir, SECRETS_FILE_NAME), safeStorage: createFakeSafeStorage({ key }), warn: () => undefined }),
      emit: () => undefined,
      detectClaudeLogin: () => Promise.reject(new Error('boom')),
      warn: () => undefined,
    });
    expect(await service.detectClaudeLogin()).toMatchObject({ ok: false, code: 'INTERNAL', message: expect.stringContaining('boom') });
  });
});
