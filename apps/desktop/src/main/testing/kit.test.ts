import { existsSync } from 'node:fs';
import type { SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeClaude, createFakeSafeStorage, createTempRepo, fakeInit, fakeTurn, type TempRepo } from '.';

/** The main-process test kit itself (AL-221): what the service tests rely on behaves as documented. */

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** An input stream the test writes to, like the session manager's streaming-input queue. */
function inputStream() {
  const queue: SDKUserMessage[] = [];
  let wake: (() => void) | undefined;
  let done = false;
  async function* stream(): AsyncGenerator<SDKUserMessage, void> {
    for (;;) {
      const next = queue.shift();
      if (next) {
        yield next;
        continue;
      }
      if (done) return;
      await new Promise<void>((resolve) => (wake = resolve));
    }
  }
  const nudge = () => {
    const resolve = wake;
    wake = undefined;
    resolve?.();
  };
  return {
    stream: stream(),
    send(text: string, priority?: 'now' | 'next', shouldQuery?: boolean) {
      queue.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, priority, ...(shouldQuery === undefined ? {} : { shouldQuery }) } as SDKUserMessage);
      nudge();
    },
    end() {
      done = true;
      nudge();
    },
  };
}

async function take(iterator: AsyncIterator<SDKMessage>, count: number): Promise<SDKMessage[]> {
  const out: SDKMessage[] = [];
  while (out.length < count) {
    const next = await iterator.next();
    if (next.done) break;
    out.push(next.value);
  }
  return out;
}

describe('createTempRepo', () => {
  let repo: TempRepo | undefined;
  afterEach(async () => {
    await repo?.cleanup();
    repo = undefined;
  });

  it('has an origin, ticket worktrees on new branches and a teammate clone that can push', async () => {
    repo = await createTempRepo();
    expect(await repo.exec(['remote', 'get-url', 'origin'])).toBe(repo.origin);

    const worktree = await repo.addWorktree('71273-cutover-job-control');
    expect(await repo.exec(['branch', '--show-current'], worktree)).toBe('71273-cutover-job-control');

    const teammate = await repo.clone();
    await repo.write('NEWS.md', 'pushed by a teammate\n', teammate);
    const pushed = await repo.commit('Teammate change', teammate);
    await repo.exec(['push', '--quiet', 'origin', 'main'], teammate);
    expect(await repo.exec(['rev-parse', 'refs/heads/main'], repo.origin)).toBe(pushed);
    expect(await repo.exec(['rev-parse', 'main'])).not.toBe(pushed);

    const root = repo.root;
    await repo.cleanup();
    expect(existsSync(root)).toBe(false);
  });

  it('refuses to clone a repo made without an origin', async () => {
    repo = await createTempRepo({ withOrigin: false });
    await expect(repo.clone()).rejects.toThrow('no origin');
  });
});

describe('createFakeClaude', () => {
  it('replays a scripted stream, then what a live session pushes and answers', async () => {
    const fake = createFakeClaude({ live: true, messages: [fakeInit('session-1')], onSend: (message) => fakeTurn(`Done: ${String(message.message.content)}`) });
    const input = inputStream();
    const session = fake.query({ prompt: input.stream, options: {} });
    const messages = session[Symbol.asyncIterator]();

    input.send('Plan the cutover');
    const [init, assistant, result] = await take(messages, 3);
    expect(init).toMatchObject({ type: 'system', subtype: 'init', session_id: 'session-1' });
    expect(assistant).toMatchObject({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done: Plan the cutover' }] } });
    expect(result).toMatchObject({ type: 'result', is_error: false, result: 'Done: Plan the cutover' });

    fake.calls[0]!.end();
    expect(await messages.next()).toMatchObject({ done: true });
  });

  it('records inputs with their priority and every control call, in order', async () => {
    const fake = createFakeClaude({ live: true });
    const input = inputStream();
    const session = fake.query({ prompt: input.stream, options: {} });
    const call = fake.calls[0]!;

    input.send('Implement the grid');
    await call.sentCount(1);
    await session.setModel('claude-sonnet-5');
    await session.applyFlagSettings({ effortLevel: 'high' });
    await session.interrupt();
    input.send('Stop editing that file', 'now');
    input.send('Build failed: 3 errors', 'next', false);
    await call.sentCount(3);
    session.close();
    session.close();

    expect(call.inputs()).toEqual([
      { text: 'Implement the grid', priority: undefined, shouldQuery: undefined },
      { text: 'Stop editing that file', priority: 'now', shouldQuery: undefined },
      { text: 'Build failed: 3 errors', priority: 'next', shouldQuery: false },
    ]);
    expect(call.log.map((entry) => entry.kind)).toEqual(['input', 'setModel', 'applyFlagSettings', 'interrupt', 'input', 'input', 'close']);
    expect(call.log[1]).toEqual({ kind: 'setModel', model: 'claude-sonnet-5' });
    expect(call.log[2]).toEqual({ kind: 'applyFlagSettings', settings: { effortLevel: 'high' } });
    expect(call).toMatchObject({ interrupts: 1, models: ['claude-sonnet-5'], flagSettings: [{ effortLevel: 'high' }], closed: true });
    input.end();
  });

  it('fails the stream like a process that died', async () => {
    const fake = createFakeClaude({ messages: [fakeInit('session-2')], failWith: new Error('claude exited with code 1') });
    const session = fake.query({ prompt: 'hello', options: {} });
    const messages = session[Symbol.asyncIterator]();
    await expect(take(messages, 2)).rejects.toThrow('claude exited with code 1');
    expect(fake.calls[0]!.prompt).toBe('hello');
  });
});

describe('createFakeSafeStorage', () => {
  it('encrypts for real, and another key cannot decrypt', () => {
    const storage = createFakeSafeStorage();
    const sealed = storage.encryptString('fake-pat-value');
    expect(sealed.toString('utf8')).not.toContain('fake-pat-value');
    expect(storage.decryptString(sealed)).toBe('fake-pat-value');
    expect(() => createFakeSafeStorage().decryptString(sealed)).toThrow();
  });
});
