import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import {
  claudeConnectionStatusLine,
  type ClaudeConnectionSummary,
  type ClaudeLoginDetection,
  type ConnectionSummary,
  type ConnectionTestResult,
  type Result,
} from '@agent-lanes/contracts';

/**
 * AL-044 against the real app: the bundled main process loads the real Agent SDK, which starts
 * `e2e/fixtures/fake-claude-code.mjs` in place of the `claude` binary (AGENT_LANES_CLAUDE_EXECUTABLE,
 * honoured only in unpackaged builds). The fake speaks the SDK's stream-json protocol and contacts
 * nothing, so no Claude account, login or API is involved.
 */

const FAKE_CLAUDE = join(__dirname, 'fixtures', 'fake-claude-code.mjs');

/** Made up for this test; shaped like real keys, valid nowhere. */
const GOOD_KEY = 'sk-ant-e2e-1111-not-a-real-key-1111-Gd34';
const BAD_KEY = 'sk-ant-e2e-0000-not-a-real-key-0000-Ab12';
/** In the app's own environment, as if the user had exported a key: the login must not use it. */
const INHERITED_KEY = 'sk-ant-e2e-9999-inherited-not-real-9999-Zz99';
const KEYS = [GOOD_KEY, BAD_KEY, INHERITED_KEY];

const LOGIN = { email: 'kyle@example.test', organization: 'Companion Systems', subscriptionType: 'team' };

interface FakeStart {
  argv: string[];
  apiKey: 'accepted' | 'refused' | null;
  prompts: string[];
}

interface Bridge {
  invoke(channel: string, payload?: unknown): Promise<unknown>;
}

let dir: string;
let userDataDir: string;
let stateFile: string;
let logFile: string;
let app: ElectronApplication | undefined;
let page: Page;
const replies: unknown[] = [];

function setFakeState(state: { loggedIn: boolean }): void {
  writeFileSync(stateFile, JSON.stringify({ login: state.loggedIn ? LOGIN : null, apiKeys: [GOOD_KEY], log: logFile }));
}

/** Every time the app started the fake, in order. The fake writes its line as it exits. */
function fakeStarts(): FakeStart[] {
  if (!existsSync(logFile)) return [];
  return readFileSync(logFile, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as FakeStart);
}

/** The fake's record of its `count`th start, once that process has exited. */
async function fakeStart(count: number): Promise<FakeStart | undefined> {
  await expect.poll(() => fakeStarts().length).toBe(count);
  return fakeStarts()[count - 1];
}

async function launch(): Promise<void> {
  app = await electron.launch({
    args: [join(__dirname, '..')],
    env: {
      ...process.env,
      AGENT_LANES_USER_DATA_DIR: userDataDir,
      AGENT_LANES_CLAUDE_EXECUTABLE: FAKE_CLAUDE,
      AGENT_LANES_FAKE_CLAUDE_STATE: stateFile,
      ANTHROPIC_API_KEY: INHERITED_KEY,
    },
  });
  page = await app.firstWindow();
  await expect(page.getByText('Agent board')).toBeVisible();
}

async function close(): Promise<void> {
  await app?.close();
  app = undefined;
}

async function data<T>(channel: string, payload?: unknown): Promise<T> {
  const reply = (await page.evaluate(
    ([name, body]) => (globalThis as unknown as { agentLanes: Bridge }).agentLanes.invoke(name, body),
    [channel, payload] as const,
  )) as Result<T>;
  replies.push(reply);
  if (!reply.ok) throw new Error(`${channel} failed: ${reply.code} ${reply.message}`);
  return reply.data;
}

async function claudeRow(): Promise<ClaudeConnectionSummary> {
  const row = (await data<ConnectionSummary[]>('connections:list')).find((item) => item.kind === 'claude');
  if (row?.kind !== 'claude') throw new Error('no Claude row');
  return row;
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'agent-lanes-e2e-claude-'));
  userDataDir = join(dir, 'profile');
  stateFile = join(dir, 'fake-claude-state.json');
  logFile = join(dir, 'fake-claude-starts.jsonl');
  setFakeState({ loggedIn: true });
  await launch();
});

test.afterAll(async () => {
  await close();
  rmSync(dir, { recursive: true, force: true });
});

test('a Claude Code login on the machine connects with no key entered', async () => {
  expect(await data<ConnectionSummary[]>('connections:list')).toEqual([]);
  // Nothing starts Claude Code until the user asks.
  expect(fakeStarts()).toEqual([]);

  const detected = await data<ClaudeLoginDetection>('connections:detectClaude');
  expect(detected).toMatchObject({
    found: true,
    identity: 'kyle@example.test (Companion Systems)',
    email: 'kyle@example.test',
    organization: 'Companion Systems',
    plan: 'team',
    provider: 'Anthropic',
    message: null,
  });
  // The fake answered (not a real claude), the inherited key was dropped, and no prompt was sent.
  expect(await fakeStart(1)).toMatchObject({ apiKey: null, prompts: [] });

  const tested = await data<ConnectionTestResult>('connections:test', { draft: { kind: 'claude', mode: 'login' } });
  expect(tested).toMatchObject({ status: 'ok', identity: 'kyle@example.test (Companion Systems)', message: null });
  const testRun = await fakeStart(2);
  expect(testRun).toMatchObject({ apiKey: null, prompts: ['Reply with the single word OK.'] });
  // One turn, the small model, no tools, nothing written to ~/.claude/projects.
  expect(testRun?.argv.join(' ')).toContain('--max-turns 1');
  expect(testRun?.argv.join(' ')).toContain('--model haiku');
  expect(testRun?.argv).toContain('--no-session-persistence');
  expect(testRun?.argv).toEqual(expect.arrayContaining(['--tools', '']));

  const saved = await data<ConnectionSummary>('connections:save', { kind: 'claude', mode: 'login' });
  expect(saved).toMatchObject({ id: 'claude', kind: 'claude', mode: 'login', status: 'ok', maskedToken: null, identity: 'kyle@example.test (Companion Systems)' });
  expect(claudeConnectionStatusLine(await claudeRow())).toBe('Connected · using your Claude Code login');
});

test('without a login, the check says so and the login test fails', async () => {
  setFakeState({ loggedIn: false });
  expect(await data<ClaudeLoginDetection>('connections:detectClaude')).toMatchObject({ found: false, message: expect.stringContaining('/login') });
  expect(await data<ConnectionTestResult>('connections:test', { id: 'claude' })).toMatchObject({
    status: 'error',
    message: expect.stringContaining("Claude Code isn't signed in"),
  });
  expect(await claudeRow()).toMatchObject({ status: 'error', identity: 'kyle@example.test (Companion Systems)' });
  expect(await fakeStart(4)).toMatchObject({ apiKey: null });
});

test('an invalid API key shows a clear error and stays red', async () => {
  test.slow(); // a relaunch
  const draft = { kind: 'claude', mode: 'api-key', apiKey: BAD_KEY };

  const tested = await data<ConnectionTestResult>('connections:test', { draft });
  expect(tested).toMatchObject({
    status: 'error',
    message: 'Anthropic refused this API key. Check that it was copied in full and is still active in the Claude Console, then test again.',
  });
  expect(await fakeStart(5)).toMatchObject({ apiKey: 'refused' });

  const replaced = await data<ConnectionSummary>('connections:replace', { id: 'claude', draft });
  expect(replaced).toMatchObject({ mode: 'api-key', status: 'error', statusMessage: tested.message, maskedToken: '••••••••Ab12' });
  expect(claudeConnectionStatusLine(await claudeRow())).toBe(tested.message);

  await close();
  await launch();
  expect(await claudeRow()).toMatchObject({ status: 'error', statusMessage: tested.message });
  expect(await data<ConnectionTestResult>('connections:test', { id: 'claude' })).toMatchObject({ status: 'error' });
  expect(await claudeRow()).toMatchObject({ status: 'error', statusMessage: tested.message });

  // A good key turns it green.
  await data<ConnectionSummary>('connections:replace', { id: 'claude', draft: { ...draft, apiKey: GOOD_KEY } });
  expect(await data<ConnectionTestResult>('connections:test', { id: 'claude' })).toMatchObject({ status: 'ok' });
  expect(await fakeStart(7)).toMatchObject({ apiKey: 'accepted' });
  expect(claudeConnectionStatusLine(await claudeRow())).toBe('Connected · using an API key ••••••••Gd34');

  // No reply or file the app wrote holds a key.
  const written = [JSON.stringify(replies), readFileSync(join(userDataDir, 'connections.json'), 'utf8'), readFileSync(join(userDataDir, 'secrets.json'), 'utf8')];
  for (const text of written) for (const key of KEYS) expect(text).not.toContain(key);
});
