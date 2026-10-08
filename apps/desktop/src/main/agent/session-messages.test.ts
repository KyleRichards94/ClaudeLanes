import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { skillCommand } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { handleInvoke } from '../ipc/handle-invoke';
import { createClaudeLauncher } from './claude-sdk';
import { createAgentHandlers } from './handlers';
import { createTranscriptService } from './output/transcript';
import { RESUME_MESSAGE, createSessionManager } from './session-manager';
import { createStageService } from './stages/stage-service';
import { createSubagentTracker } from './subagents/subagent-tracker';
import { createFakeClaude, fakeAssistant, fakeInit, fakeResult, type FakeClaudeCall } from './testing/fake-claude';
import { eventually, fakeClaudeConnections, memoryTickets, recordingEmit } from './testing/sessions';

/**
 * AL-105: messages, skill chips and pause. The fake session answers nothing on its own: each test
 * plays the `claude` process, so it controls when a turn is in progress and when it ends.
 */

const toolUse = (id: string): SDKMessage =>
  ({
    type: 'assistant',
    message: { id: `msg_${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: 'a.cs' } }] },
    parent_tool_use_id: null,
    uuid: `uuid-${id}`,
    session_id: 'session-a',
  }) as unknown as SDKMessage;

async function setup() {
  const fake = createFakeClaude({ live: true, messages: [fakeInit('session-a')] });
  const tickets = await memoryTickets({ id: '71273' });
  const events = recordingEmit();
  const sessions = createSessionManager({
    claude: createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query }),
    connections: fakeClaudeConnections(),
    tickets,
    emit: events.emit,
  });
  const transcripts = createTranscriptService({ sessions, tickets, emit: events.emit });
  const stages = createStageService({ tickets, emit: events.emit });
  const handlers = createAgentHandlers({ sessions, transcripts, stages, subagents: createSubagentTracker({ sessions, emit: events.emit }) });
  await sessions.start({ ticketId: '71273', jobDescription: 'Cut it over' });
  const call = fake.calls[0]!;
  await call.sentCount(1);
  return { fake, call, sessions, handlers, events };
}

const texts = (call: FakeClaudeCall) => call.sent.map((message) => message.message.content);

describe('messages mid-run (AL-105)', () => {
  it('a message sent mid-turn is delivered without killing the turn', async () => {
    const { call, sessions, handlers } = await setup();
    // The turn is running: the agent is in the middle of a tool call.
    call.push(toolUse('toolu_1'));
    await eventually(() => sessions.status('71273').state === 'running');

    const sent = await handleInvoke('agent:send', { ticketId: '71273', text: 'Also cover the date-range filter' }, handlers['agent:send']);
    expect(sent).toEqual({ ok: true, data: { held: false } });
    await call.sentCount(2);

    expect(call.sent[1]).toMatchObject({ type: 'user', priority: 'next', message: { role: 'user', content: 'Also cover the date-range filter' } });
    expect(call.interrupts).toBe(0);
    expect(call.closed).toBe(false);
    expect(sessions.status('71273').state).toBe('running');

    // The turn carries on and ends normally.
    call.push(fakeAssistant('Done with the grid.'), fakeResult());
    await eventually(() => sessions.status('71273').state === 'idle');
    await sessions.dispose();
  });

  it('"steer now" is sent with priority now (D11)', async () => {
    const { call, handlers, sessions } = await setup();
    await handleInvoke('agent:send', { ticketId: '71273', text: 'Stop editing that file', priority: 'now' }, handlers['agent:send']);
    await call.sentCount(2);
    expect(call.sent[1]).toMatchObject({ priority: 'now', message: { content: 'Stop editing that file' } });
    await sessions.dispose();
  });

  it('a skill chip sends /skill-name as the next user turn, exactly as typed in the terminal', async () => {
    const { call, handlers, sessions } = await setup();
    await handleInvoke('agent:send', { ticketId: '71273', text: skillCommand('code-review') }, handlers['agent:send']);
    await call.sentCount(2);
    // A plain string turn, not marked synthetic: Claude Code dispatches it as the slash command.
    expect(call.sent[1]).toEqual({ type: 'user', message: { role: 'user', content: '/code-review' }, parent_tool_use_id: null, priority: 'next' });
    await sessions.dispose();
  });

  it('refuses an empty message and a ticket without a session', async () => {
    const { handlers, sessions } = await setup();
    await expect(handleInvoke('agent:send', { ticketId: '71273', text: '   ' }, handlers['agent:send'])).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
    await expect(handleInvoke('agent:send', { ticketId: '71274', text: 'hello' }, handlers['agent:send'])).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
    await sessions.dispose();
  });
});

describe('pause and resume (AL-105)', () => {
  it('pause interrupts the turn and holds later messages until resume, which delivers them in order', async () => {
    const { call, sessions, handlers, events } = await setup();
    call.push(toolUse('toolu_1'));
    await eventually(() => sessions.status('71273').state === 'running');

    await expect(handleInvoke('agent:pause', { ticketId: '71273' }, handlers['agent:pause'])).resolves.toMatchObject({ ok: true, data: { state: 'paused' } });
    expect(call.interrupts).toBe(1);

    // The interrupted turn ends; the session stays paused.
    call.push(fakeResult({ is_error: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sessions.status('71273').state).toBe('paused');

    await expect(handleInvoke('agent:send', { ticketId: '71273', text: 'first' }, handlers['agent:send'])).resolves.toEqual({ ok: true, data: { held: true } });
    await expect(handleInvoke('agent:send', { ticketId: '71273', text: skillCommand('commit') }, handlers['agent:send'])).resolves.toEqual({ ok: true, data: { held: true } });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(texts(call)).toHaveLength(1);

    await expect(handleInvoke('agent:resume', { ticketId: '71273' }, handlers['agent:resume'])).resolves.toMatchObject({ ok: true, data: { state: 'running' } });
    await call.sentCount(3);
    expect(texts(call).slice(1)).toEqual(['first', '/commit']);
    expect(events.of('agent:status', '71273').map((event) => event['state'])).toEqual(['starting', 'running', 'paused', 'running']);
    await sessions.dispose();
  });

  it('resume with nothing held sends a continue turn', async () => {
    const { call, sessions } = await setup();
    await sessions.pause('71273');
    expect(sessions.resume('71273')).toMatchObject({ ok: true, data: { state: 'running' } });
    await call.sentCount(2);
    expect(call.sent[1]?.message.content).toBe(RESUME_MESSAGE);
    await sessions.dispose();
  });

  it('pause and resume twice change nothing more; a stopped session cannot be paused', async () => {
    const { call, sessions } = await setup();
    await sessions.pause('71273');
    await sessions.pause('71273');
    expect(call.interrupts).toBe(1);
    sessions.resume('71273');
    expect(sessions.resume('71273')).toMatchObject({ ok: true });
    await call.sentCount(2);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(call.sent).toHaveLength(2);

    await sessions.stop('71273');
    await expect(sessions.pause('71273')).resolves.toMatchObject({ ok: false });
    expect(sessions.resume('71273')).toMatchObject({ ok: false });
  });
});

describe('skill command (AL-105)', () => {
  it('is the skill name after a slash, and refuses anything else', () => {
    expect(skillCommand('code-review')).toBe('/code-review');
    expect(skillCommand('/cs-qa-wip')).toBe('/cs-qa-wip');
    expect(skillCommand('anthropic-skills:commit')).toBe('/anthropic-skills:commit');
    expect(() => skillCommand('rm -rf /')).toThrow();
    expect(() => skillCommand('')).toThrow();
  });
});
