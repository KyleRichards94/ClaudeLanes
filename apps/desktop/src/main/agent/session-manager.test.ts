import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { createClaudeLauncher } from './claude-sdk';
import { createSessionManager, SESSION_ENDED_MESSAGE, type SessionManagerOptions } from './session-manager';
import { createFakeClaude, fakeAssistant, fakeInit, fakeResult, type FakeClaudeScript } from './testing/fake-claude';
import { eventually, fakeClaudeConnections, memoryTickets, recordingEmit } from './testing/sessions';

/** Made up for these tests; shaped like a real key, valid nowhere. */
const TEST_KEY = 'sk-ant-test-2222-not-a-real-key-2222-Xy56';

const JOB = 'Cut frmJobControl over to Blazor and stop for my approval before the PR.';
const WORK_ITEM = { id: 71273, title: 'Cutover frmJobControl to Blazor', type: 'User Story', state: 'Active', description: '<p>Move the <b>job grid</b> to Blazor.</p>' };

/** A running `claude` that reports its session id, then answers every user turn with one reply and a result. */
const answering: FakeClaudeScript = {
  live: true,
  messages: [fakeInit('session-a')],
  onSend: (message) => [fakeAssistant(`echo: ${String(message.message.content).slice(0, 20)}`), fakeResult()],
};

async function setup(
  script: Parameters<typeof createFakeClaude>[0] = answering,
  overrides: Partial<SessionManagerOptions> = {},
  baseEnv: NodeJS.ProcessEnv = { PATH: 'C:\\Windows' },
) {
  const fake = createFakeClaude(script);
  const claude = createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query, baseEnv: () => baseEnv });
  const tickets = await memoryTickets({ id: '71273' }, { id: '71274', title: 'Asset register paging slow above 5k rows' });
  const events = recordingEmit();
  const sessions = createSessionManager({ claude, connections: fakeClaudeConnections('login'), tickets, emit: events.emit, ...overrides });
  return { fake, tickets, events, sessions };
}

describe('session manager: starting a session', () => {
  it('starts one streaming-input query in the ticket worktree with the AL-100 options', async () => {
    const { fake, tickets, sessions } = await setup();
    const record = await tickets.get('71273');

    const started = await sessions.start({ ticketId: '71273', jobDescription: JOB, workItem: WORK_ITEM });

    expect(started).toMatchObject({ ok: true, data: { ticketId: '71273', state: 'running' } });
    expect(fake.calls).toHaveLength(1);
    const call = fake.calls[0]!;
    expect(call.prompt).toBeUndefined(); // an input stream, not a one-shot prompt
    expect(call.options).toMatchObject({
      cwd: record?.worktreePath,
      projectConfigRoot: record?.repo,
      model: 'claude-opus-5-5',
      effort: 'xhigh',
      thinking: { type: 'adaptive' },
      settingSources: ['user', 'project', 'local'],
      includePartialMessages: true,
      permissionMode: 'acceptEdits',
      systemPrompt: { type: 'preset', preset: 'claude_code' },
      pathToClaudeCodeExecutable: 'C:\\claude.exe',
    });
    expect(call.options.abortController).toBeInstanceOf(AbortController);
    expect(call.options.resume).toBeUndefined();
    await sessions.dispose();
  });

  it('sends the job description, the work item and the selected skills as the first user turn', async () => {
    const { fake, sessions } = await setup();
    await sessions.start({ ticketId: '71273', jobDescription: JOB, workItem: WORK_ITEM });
    await fake.calls[0]!.sentCount(1);

    const first = fake.calls[0]!.sent[0]!;
    expect(first).toMatchObject({ type: 'user', parent_tool_use_id: null, message: { role: 'user' } });
    const text = String(first.message.content);
    expect(text).toContain('#71273: Cutover frmJobControl to Blazor (User Story · Active)');
    expect(text).toContain('Move the job grid to Blazor.');
    expect(text).toContain(JOB);
    expect(text).toContain('/code-review');
    await sessions.dispose();
  });

  it('runs with the Claude Code login and drops an inherited ANTHROPIC_API_KEY (D334)', async () => {
    const { fake, sessions } = await setup(answering, {}, { PATH: 'C:\\Windows', ANTHROPIC_API_KEY: TEST_KEY });
    await sessions.start({ ticketId: '71273', jobDescription: JOB });
    expect(fake.calls[0]!.options.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    await sessions.dispose();
  });

  it('runs with the saved API key when the Claude connection is an API key', async () => {
    const { fake, sessions } = await setup(answering, { connections: fakeClaudeConnections('api-key', TEST_KEY) });
    await sessions.start({ ticketId: '71273', jobDescription: JOB });
    expect(fake.calls[0]!.options.env).toMatchObject({ ANTHROPIC_API_KEY: TEST_KEY });
    await sessions.dispose();
  });

  it('starts nothing without a Claude connection, or when its key cannot be read', async () => {
    const none = await setup(answering, { connections: fakeClaudeConnections('none') });
    await expect(none.sessions.start({ ticketId: '71273', jobDescription: JOB })).resolves.toMatchObject({
      ok: false,
      code: 'VALIDATION',
      details: { reason: 'claude-not-connected' },
    });
    expect(none.fake.calls).toHaveLength(0);
    expect(none.sessions.status('71273')).toMatchObject({ state: 'stopped' });

    const unreadable = await setup(answering, { connections: fakeClaudeConnections('api-key', undefined) });
    await expect(unreadable.sessions.start({ ticketId: '71273', jobDescription: JOB })).resolves.toMatchObject({
      ok: false,
      details: { reason: 'claude-key-unreadable' },
    });
    expect(unreadable.fake.calls).toHaveLength(0);
  });

  it('refuses an unknown ticket and a new session without a job description', async () => {
    const { fake, sessions } = await setup();
    await expect(sessions.start({ ticketId: '99999', jobDescription: JOB })).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
    await expect(sessions.start({ ticketId: '71273', jobDescription: '  ' })).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(fake.calls).toHaveLength(0);
  });

  it('reports a missing claude binary without leaving a session behind', async () => {
    const fake = createFakeClaude(answering);
    const claude = createClaudeLauncher({ executable: () => null, query: () => fake.query });
    const events = recordingEmit();
    const sessions = createSessionManager({ claude, connections: fakeClaudeConnections(), tickets: await memoryTickets({ id: '71273' }), emit: events.emit });

    const started = await sessions.start({ ticketId: '71273', jobDescription: JOB });
    expect(started).toMatchObject({ ok: false, code: 'INTERNAL', message: expect.stringContaining('Reinstall Agent Lanes') });
    expect(sessions.status('71273')).toMatchObject({ state: 'stopped', message: expect.stringContaining('Reinstall Agent Lanes') });
    expect(fake.calls).toHaveLength(0);
  });

  it('starts one process when the same ticket is started twice at once', async () => {
    const { fake, sessions } = await setup();
    const [a, b] = await Promise.all([
      sessions.start({ ticketId: '71273', jobDescription: JOB }),
      sessions.start({ ticketId: '71273', jobDescription: JOB }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(fake.calls).toHaveLength(1);
    await sessions.dispose();
  });
});

describe('session manager: session id and status', () => {
  it('saves the session id from system/init on the ticket at once, and reports running → idle', async () => {
    const { fake, tickets, events, sessions } = await setup();
    await sessions.start({ ticketId: '71273', jobDescription: JOB });

    await eventually(() => sessions.status('71273').state === 'idle');
    expect((await tickets.get('71273'))?.sessionId).toBe('session-a');
    expect(sessions.status('71273')).toEqual({ ticketId: '71273', state: 'idle', sessionId: 'session-a', message: null });
    expect(events.of('agent:status', '71273').map((event) => event['state'])).toEqual(['starting', 'running', 'idle']);
    expect(fake.calls[0]!.closed).toBe(false);
    await sessions.dispose();
  });

  it('resumes a ticket that has a session id, without a new first turn', async () => {
    const { fake, tickets, sessions } = await setup({ live: true });
    await tickets.update('71273', (record) => ({ ...record, sessionId: 'session-before-restart' }));

    const started = await sessions.start({ ticketId: '71273' });
    expect(started).toMatchObject({ ok: true, data: { state: 'idle', sessionId: 'session-before-restart' } });
    expect(fake.calls[0]!.options.resume).toBe('session-before-restart');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake.calls[0]!.sent).toEqual([]);
    await sessions.dispose();
  });

  it('marks a session that ends on its own as lost, and refuses messages with SESSION_LOST', async () => {
    const { fake, sessions } = await setup();
    await sessions.start({ ticketId: '71273', jobDescription: JOB });
    await eventually(() => sessions.status('71273').state === 'idle');

    fake.calls[0]!.fail(new Error('Claude Code process exited with code 1'));
    await eventually(() => sessions.status('71273').state === 'lost');
    expect(sessions.status('71273').message).toBe(SESSION_ENDED_MESSAGE);
    expect(sessions.send('71273', { text: 'still there?' })).toMatchObject({ ok: false, code: 'SESSION_LOST' });
    expect(fake.calls[0]!.closed).toBe(true);
  });

  it('serves agent:getStatus for a ticket without a session', async () => {
    const { sessions } = await setup();
    expect(sessions.status('71274')).toEqual({ ticketId: '71274', state: 'none', sessionId: null, message: null });
  });
});

describe('session manager: two tickets at once', () => {
  it('runs two tickets concurrently in different worktrees without cross-talk', async () => {
    const fake = createFakeClaude((call) => ({
      live: true,
      messages: [fakeInit(call.options.cwd?.endsWith('71273') ? 'session-73' : 'session-74')],
      onSend: (message) => [fakeAssistant(`${call.options.cwd} got: ${String(message.message.content)}`), fakeResult()],
    }));
    const claude = createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query, baseEnv: () => ({}) });
    const tickets = await memoryTickets({ id: '71273' }, { id: '71274' });
    const sessions = createSessionManager({ claude, connections: fakeClaudeConnections(), tickets, emit: recordingEmit().emit });
    const seen: Array<{ ticketId: string; message: SDKMessage }> = [];
    sessions.subscribe((event) => seen.push(event));

    await Promise.all([sessions.start({ ticketId: '71273', jobDescription: 'job A' }), sessions.start({ ticketId: '71274', jobDescription: 'job B' })]);
    await eventually(() => sessions.status('71273').state === 'idle' && sessions.status('71274').state === 'idle');

    const [a, b] = fake.calls;
    expect(a!.options.cwd).not.toBe(b!.options.cwd);
    expect(a!.options.abortController).not.toBe(b!.options.abortController);

    expect(sessions.send('71273', { text: 'only for A' })).toEqual({ ok: true, data: { held: false } });
    await a!.sentCount(2);
    await eventually(() => sessions.status('71273').state === 'idle');
    expect(a!.sent.map((message) => message.message.content)).toContain('only for A');
    expect(b!.sent.map((message) => message.message.content)).not.toContain('only for A');

    // Every message reached the listener tagged with the ticket whose process produced it.
    for (const { ticketId, message } of seen) {
      if (message.type === 'assistant') expect(JSON.stringify(message.message.content)).toContain(ticketId);
      if (message.type === 'system') expect(message.session_id).toBe(ticketId === '71273' ? 'session-73' : 'session-74');
    }
    expect((await tickets.get('71273'))?.sessionId).toBe('session-73');
    expect((await tickets.get('71274'))?.sessionId).toBe('session-74');

    // Stopping one leaves the other running.
    await sessions.stop('71273');
    expect(a!.closed).toBe(true);
    expect(b!.closed).toBe(false);
    expect(sessions.status('71274').state).toBe('idle');
    await sessions.dispose();
    expect(b!.closed).toBe(true);
  });
});

describe('session manager: controls', () => {
  it('queues a user turn with priority next by default and now when asked (D11)', async () => {
    const { fake, sessions } = await setup();
    await sessions.start({ ticketId: '71273', jobDescription: JOB });

    sessions.send('71273', { text: 'add bUnit tests too' });
    sessions.send('71273', { text: 'stop editing that file', priority: 'now' });
    sessions.send('71273', { text: 'Build failed: 3 errors', shouldQuery: false });
    await fake.calls[0]!.sentCount(4);

    expect(fake.calls[0]!.sent.slice(1).map(({ message, priority, shouldQuery }) => ({ text: message.content, priority, shouldQuery }))).toEqual([
      { text: 'add bUnit tests too', priority: 'next', shouldQuery: undefined },
      { text: 'stop editing that file', priority: 'now', shouldQuery: undefined },
      { text: 'Build failed: 3 errors', priority: 'next', shouldQuery: false },
    ]);
    expect(sessions.send('71274', { text: 'nobody home' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(sessions.send('71273', { text: '   ' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    await sessions.dispose();
  });

  it('interrupts, switches model and applies effort on the live session, saving them on the ticket', async () => {
    const { fake, tickets, sessions } = await setup();
    await sessions.start({ ticketId: '71273', jobDescription: JOB });

    await expect(sessions.interrupt('71273')).resolves.toEqual({ ok: true, data: undefined });
    await expect(sessions.setModel('71273', 'sonnet')).resolves.toEqual({ ok: true, data: undefined });
    await expect(sessions.setEffort('71273', 'high')).resolves.toEqual({ ok: true, data: undefined });

    expect(fake.calls[0]!.interrupts).toBe(1);
    expect(fake.calls[0]!.models).toEqual(['claude-sonnet-5-5']);
    expect(fake.calls[0]!.flagSettings).toEqual([{ effortLevel: 'high' }]);
    expect(await tickets.get('71273')).toMatchObject({ model: 'sonnet', effort: 'high' });
    await sessions.dispose();
  });

  it('saves model and effort for a ticket without a live session', async () => {
    const { fake, tickets, sessions } = await setup();
    await sessions.setModel('71274', 'haiku');
    await sessions.setEffort('71274', 'low');
    expect(await tickets.get('71274')).toMatchObject({ model: 'haiku', effort: 'low' });
    expect(fake.calls).toHaveLength(0);
    await expect(sessions.interrupt('71274')).resolves.toMatchObject({ ok: false });
  });
});

describe('session manager: closing sessions', () => {
  it("closing a ticket's session closes its process and input, and reports stopped", async () => {
    const { fake, events, sessions } = await setup();
    await sessions.start({ ticketId: '71273', jobDescription: JOB });
    await eventually(() => sessions.status('71273').state === 'idle');
    const signal = fake.calls[0]!.options.abortController!.signal;

    await expect(sessions.stop('71273')).resolves.toEqual({ ok: true, data: true });

    expect(fake.calls[0]!.closed).toBe(true);
    expect(signal.aborted).toBe(true);
    expect(sessions.status('71273')).toMatchObject({ state: 'stopped', message: null });
    expect(events.of('agent:status', '71273').at(-1)).toMatchObject({ state: 'stopped' });
    expect(sessions.send('71273', { text: 'hello?' })).toMatchObject({ ok: false });
    await expect(sessions.stop('71273')).resolves.toEqual({ ok: true, data: false });
  });

  it('midTurn lists the tickets whose agent is in a turn, not idle or stopped ones (AL-213)', async () => {
    const { fake, sessions } = await setup({ live: true, messages: [fakeInit('session-busy')] });
    expect(sessions.midTurn()).toEqual([]);
    await sessions.start({ ticketId: '71273', jobDescription: JOB });
    expect(sessions.midTurn()).toEqual(['71273']);
    // The turn ends: the agent is idle and quitting no longer cuts it off.
    fake.calls[0]!.push(fakeResult());
    await eventually(() => sessions.status('71273').state === 'idle');
    expect(sessions.midTurn()).toEqual([]);
    await sessions.dispose();
    expect(sessions.midTurn()).toEqual([]);
  });

  it('dispose closes every live session (app quit)', async () => {
    const { fake, sessions } = await setup();
    await sessions.start({ ticketId: '71273', jobDescription: JOB });
    await sessions.start({ ticketId: '71274', jobDescription: JOB });
    await sessions.dispose();
    expect(fake.calls.map((call) => call.closed)).toEqual([true, true]);
  });

  it('can start a ticket again after its session stopped, resuming the saved session id', async () => {
    const { fake, sessions } = await setup();
    await sessions.start({ ticketId: '71273', jobDescription: JOB });
    await eventually(() => sessions.status('71273').state === 'idle');
    await sessions.stop('71273');

    await sessions.start({ ticketId: '71273' });
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.options.resume).toBe('session-a');
    await sessions.dispose();
  });
});
