import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { ToastEventSchema } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { createClaudeLauncher } from './claude-sdk';
import { RECOVERED_MESSAGE, SESSION_LOST_TITLE, createSessionRecovery, sessionLostToastId, type SessionRecovery } from './recovery';
import { createSessionManager, sessionStalledMessage, type SessionManager } from './session-manager';
import { createFakeClaude, fakeAssistant, fakeInit, fakeResult } from './testing/fake-claude';
import { eventually, fakeClaudeConnections, memoryTickets, recordingEmit } from './testing/sessions';

async function setup(options: { watchdogMs?: number; waiting?: () => boolean } = {}) {
  const fake = createFakeClaude({ live: true, messages: [fakeInit('session-a')] });
  const tickets = await memoryTickets({ id: '71273' });
  const events = recordingEmit();
  const ended: { recovery?: SessionRecovery } = {};
  const sessions: SessionManager = createSessionManager({
    claude: createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query }),
    connections: fakeClaudeConnections(),
    tickets,
    emit: events.emit,
    onEnded: (ticketId, state, info) => ended.recovery?.onEnded(ticketId, state, info),
    watchdogMs: options.watchdogMs ?? 0,
    ...(options.waiting ? { isWaitingOnUser: options.waiting } : {}),
  });
  const recovery = createSessionRecovery({ sessions, emit: events.emit });
  ended.recovery = recovery;
  const record = (await tickets.get('71273'))!;
  return { fake, tickets, events, sessions, recovery, record };
}

const text = (message: SDKUserMessage | undefined) => message?.message.content as string;

describe('crash recovery (AL-110)', () => {
  it('resumes a session whose claude process dies mid-run, from its saved session id in the same worktree', async () => {
    const { fake, tickets, events, sessions, record } = await setup();
    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    const first = fake.calls[0]!;
    await first.sentCount(1);
    await eventually(() => sessions.status('71273').sessionId === 'session-a');
    first.push(fakeAssistant('Reading frmJobControl.vb'));

    // The process is killed mid-turn.
    first.fail(new Error('Claude Code process exited with code 1'));

    await eventually(() => fake.calls.length === 2);
    const second = fake.calls[1]!;
    expect(second.options.resume).toBe('session-a');
    expect(second.options.cwd).toBe(record.worktreePath);
    await second.sentCount(1);
    // No new job turn: the conversation resumes, and the agent is told to carry on.
    expect(text(second.sent[0])).toBe(RECOVERED_MESSAGE);
    await eventually(() => sessions.status('71273').state === 'running');
    expect((await tickets.get('71273'))?.sessionId).toBe('session-a');
    expect((await tickets.get('71273'))?.worktreePath).toBe(record.worktreePath);
    expect(events.of('toast')).toEqual([]);
    await sessions.dispose();
  });

  it('asks the user with Reconnect / Dismiss when the resumed session is lost again, and Reconnect resumes it', async () => {
    const { fake, events, sessions, recovery } = await setup();
    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await fake.calls[0]!.sentCount(1);
    await eventually(() => sessions.status('71273').sessionId === 'session-a');
    fake.calls[0]!.fail(new Error('exited'));
    await eventually(() => fake.calls.length === 2);
    await fake.calls[1]!.sentCount(1);

    fake.calls[1]!.end();
    await eventually(() => events.of('toast').length === 1);
    expect(fake.calls).toHaveLength(2);
    expect(sessions.status('71273').state).toBe('lost');
    const toast = ToastEventSchema.parse({ ...events.of('toast')[0], at: 1 });
    expect(toast).toMatchObject({
      id: sessionLostToastId('71273'),
      tone: 'error',
      title: SESSION_LOST_TITLE,
      body: '71273 stopped responding. The worktree is intact.',
      actions: [{ label: 'Reconnect', intent: { type: 'reconnectSession', ticketId: '71273' } }],
    });

    const reconnected = await recovery.reconnect('71273');
    expect(reconnected.ok && reconnected.data.state).toBe('running');
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[2]!.options.resume).toBe('session-a');
    await sessions.dispose();
  });

  it('does not tell an idle session to continue when it is resumed', async () => {
    const fake = createFakeClaude({ live: true, messages: [fakeInit('session-a')], onSend: () => [fakeAssistant('Done'), fakeResult()] });
    const tickets = await memoryTickets({ id: '71273' });
    const ended: { recovery?: SessionRecovery } = {};
    const sessions = createSessionManager({
      claude: createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query }),
      connections: fakeClaudeConnections(),
      tickets,
      emit: recordingEmit().emit,
      onEnded: (ticketId, state, info) => ended.recovery?.onEnded(ticketId, state, info),
      watchdogMs: 0,
    });
    ended.recovery = createSessionRecovery({ sessions, emit: recordingEmit().emit });
    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await eventually(() => sessions.status('71273').state === 'idle');
    fake.calls[0]!.end();
    await eventually(() => fake.calls.length === 2 && sessions.status('71273').state === 'idle');
    expect(fake.calls[1]!.sent).toEqual([]);
    await sessions.dispose();
  });

  it('treats a running session that stays silent past the watchdog as lost, and resumes it', async () => {
    const { fake, sessions } = await setup({ watchdogMs: 40 });
    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await fake.calls[0]!.sentCount(1);
    await eventually(() => fake.calls.length === 2, 3_000);
    expect(fake.calls[0]!.closed).toBe(true);
    expect(fake.calls[1]!.options.resume).toBe('session-a');
    await sessions.dispose();
  });

  it('never trips the watchdog while the ticket waits on the user', async () => {
    const { fake, sessions, events } = await setup({ watchdogMs: 30, waiting: () => true });
    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await fake.calls[0]!.sentCount(1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(fake.calls).toHaveLength(1);
    expect(sessions.status('71273').state).toBe('running');
    expect(events.of('agent:status', '71273').some((event) => event['message'] === sessionStalledMessage('71273'))).toBe(false);
    await sessions.dispose();
  });

  it('asks the user when there is no saved session to resume', async () => {
    const fake = createFakeClaude({ live: true });
    const tickets = await memoryTickets({ id: '71273' });
    const events = recordingEmit();
    const ended: { recovery?: SessionRecovery } = {};
    const sessions = createSessionManager({
      claude: createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query }),
      connections: fakeClaudeConnections(),
      tickets,
      emit: events.emit,
      onEnded: (ticketId, state, info) => ended.recovery?.onEnded(ticketId, state, info),
      watchdogMs: 0,
    });
    ended.recovery = createSessionRecovery({ sessions, emit: events.emit });
    await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
    await fake.calls[0]!.sentCount(1);
    fake.calls[0]!.fail(new Error('exited before init'));
    await eventually(() => events.of('toast').length === 1);
    expect(fake.calls).toHaveLength(1);
    expect(events.of('toast')[0]?.['body']).toContain('no saved session');
  });
});
