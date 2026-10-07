import { describe, expect, it } from 'vitest';
import { invokeContracts } from '../schemas';
import { CLAUDE_LOGIN_CONNECTED_TEXT, ClaudeLoginDetectionSchema, claudeConnectionStatusLine } from './connections.claude';
import { CONNECTIONS_INVOKE_CHANNELS } from './connections.names';

const found = {
  found: true,
  identity: 'kyle@example.test (Companion Systems)',
  email: 'kyle@example.test',
  organization: 'Companion Systems',
  plan: 'team',
  provider: 'Anthropic',
  message: null,
  checkedAt: '2026-10-07T03:00:00.000Z',
};

describe('connections:detectClaude', () => {
  it('is a declared channel that takes no request', () => {
    expect(CONNECTIONS_INVOKE_CHANNELS).toContain('connections:detectClaude');
    const contract = invokeContracts['connections:detectClaude'];
    expect(contract.request.safeParse(undefined).success).toBe(true);
    expect(contract.request.safeParse({ apiKey: 'x' }).success).toBe(false);
  });

  it('answers with account details only', () => {
    expect(ClaudeLoginDetectionSchema.parse(found)).toEqual(found);
    const none = { ...found, found: false, identity: null, email: null, organization: null, plan: null, provider: null, message: 'No Claude Code login.' };
    expect(ClaudeLoginDetectionSchema.parse(none)).toEqual(none);
    // Undeclared fields (say, a token Claude Code reported) never leave main.
    expect(ClaudeLoginDetectionSchema.parse({ ...found, oauthToken: 'sk-ant-oat01-x' })).not.toHaveProperty('oauthToken');
  });
});

describe('claudeConnectionStatusLine', () => {
  const row = { mode: 'login', status: 'ok', statusMessage: null, maskedToken: null } as const;

  it('says the Claude Code login is in use once its test passed', () => {
    expect(claudeConnectionStatusLine(row)).toBe('Connected · using your Claude Code login');
    expect(CLAUDE_LOGIN_CONNECTED_TEXT).toBe('Connected · using your Claude Code login');
  });

  it('names the masked key for an API key connection', () => {
    expect(claudeConnectionStatusLine({ ...row, mode: 'api-key', maskedToken: '••••••••Ab12' })).toBe('Connected · using an API key ••••••••Ab12');
  });

  it("shows the test's error while the status is error", () => {
    const message = 'Anthropic refused this API key.';
    expect(claudeConnectionStatusLine({ ...row, mode: 'api-key', status: 'error', statusMessage: message, maskedToken: '••••••••Ab12' })).toBe(message);
    expect(claudeConnectionStatusLine({ ...row, status: 'error' })).toBe('Not connected');
  });

  it('says when a saved connection has not been tested', () => {
    expect(claudeConnectionStatusLine({ ...row, status: 'untested' })).toBe('Saved · not tested yet');
  });
});
