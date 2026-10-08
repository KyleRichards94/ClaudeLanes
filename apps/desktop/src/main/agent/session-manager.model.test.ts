import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { APPLY_MODEL_NOW_MESSAGE } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { createClaudeLauncher } from './claude-sdk';
import { createSessionManager } from './session-manager';
import { createFakeClaude, fakeInit, fakeResult, type FakeClaudeScript } from './testing/fake-claude';
import { eventually, fakeClaudeConnections, memoryTickets, recordingEmit } from './testing/sessions';

/** AL-106: live model and effort change against the fake Agent SDK. */

const JOB = 'Cut frmJobControl over to Blazor.';

/** An assistant message from the lead agent, reporting the model that answered. */
function assistantFrom(model: string, text = 'working'): SDKMessage {
  return {
    type: 'assistant',
    message: { id: `msg-${Math.random()}`, role: 'assistant', model, content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
    uuid: '00000000-0000-4000-8000-000000000010',
    session_id: 'session-a',
  } as unknown as SDKMessage;
}

async function setup(script: FakeClaudeScript = { live: true, messages: [fakeInit('session-a')] }) {
  const fake = createFakeClaude(script);
  const claude = createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query, baseEnv: () => ({}) });
  const tickets = await memoryTickets({ id: '71273', model: 'opus', effort: 'high' });
  const events = recordingEmit();
  const sessions = createSessionManager({ claude, connections: fakeClaudeConnections('login'), tickets, emit: events.emit });
  await sessions.start({ ticketId: '71273', jobDescription: JOB });
  await fake.calls[0]!.sentCount(1);
  return { fake, call: fake.calls[0]!, tickets, events, sessions };
}

describe('live model and effort change (AL-106)', () => {
  it('Opus → Sonnet mid-run shows "Opus → Sonnet · High" until an assistant message reports Sonnet', async () => {
    const { call, events, sessions } = await setup();
    call.push(assistantFrom('claude-opus-5-5', 'reading the form'));
    expect(sessions.status('71273').state).toBe('running');

    const changed = await sessions.setModel('71273', 'sonnet');
    expect(changed).toEqual({ ok: true, data: { ticketId: '71273', model: 'opus', effort: 'high', pending: { model: 'sonnet', effort: 'high' } } });
    expect(call.models).toEqual(['claude-sonnet-5-5']);
    expect(events.of('agent:model', '71273').at(-1)).toMatchObject({ model: 'opus', effort: 'high', pending: { model: 'sonnet', effort: 'high' } });

    // Still Opus answering in this turn: the switch stays pending.
    call.push(assistantFrom('claude-opus-5-5', 'still the old model'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await sessions.modelState('71273')).ok && (await sessions.modelState('71273'))).toMatchObject({ data: { pending: { model: 'sonnet' } } });

    // The next request reports Sonnet: applied, and the pill clears.
    call.push(assistantFrom('claude-sonnet-5-5-20261001', 'now on sonnet'));
    await eventually(() => events.of('agent:model', '71273').at(-1)?.['pending'] === null);
    expect(events.of('agent:model', '71273').at(-1)).toMatchObject({ model: 'sonnet', effort: 'high', pending: null });
    expect(await sessions.modelState('71273')).toEqual({ ok: true, data: { ticketId: '71273', model: 'sonnet', effort: 'high', pending: null } });
    await sessions.dispose();
  });

  it('an effort change clears when the next turn starts, and persists to the ticket record', async () => {
    const { call, events, sessions, tickets } = await setup();
    const changed = await sessions.setEffort('71273', 'max');
    expect(changed).toMatchObject({ ok: true, data: { effort: 'high', pending: { model: 'opus', effort: 'max' } } });
    expect(call.flagSettings).toEqual([{ effortLevel: 'max' }]);
    expect(await tickets.get('71273')).toMatchObject({ effort: 'max' });

    // Same turn: an assistant message on the same model does not apply it.
    call.push(assistantFrom('claude-opus-5-5'));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events.of('agent:model', '71273').at(-1)).toMatchObject({ pending: { effort: 'max' } });

    // The turn ends; the next turn's first message applies it.
    call.push(fakeResult());
    call.push(assistantFrom('claude-opus-5-5', 'next turn'));
    await eventually(() => events.of('agent:model', '71273').at(-1)?.['pending'] === null);
    expect(events.of('agent:model', '71273').at(-1)).toMatchObject({ model: 'opus', effort: 'max', pending: null });
    await sessions.dispose();
  });

  it('a change made while the agent is idle applies with its next message', async () => {
    const { call, events, sessions } = await setup();
    call.push(fakeResult());
    await eventually(() => sessions.status('71273').state === 'idle');
    await sessions.setEffort('71273', 'low');
    call.push(assistantFrom('claude-opus-5-5'));
    await eventually(() => events.of('agent:model', '71273').at(-1)?.['pending'] === null);
    await sessions.dispose();
  });

  it('switching back to what runs clears the pending change, and sub-agent messages never apply it', async () => {
    const { call, events, sessions } = await setup();
    await sessions.setModel('71273', 'haiku');
    call.push({ ...(assistantFrom('claude-haiku-4-5') as object), parent_tool_use_id: 'toolu_agent_1' } as SDKMessage);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events.of('agent:model', '71273').at(-1)).toMatchObject({ pending: { model: 'haiku' } });

    expect(await sessions.setModel('71273', 'opus')).toMatchObject({ ok: true, data: { model: 'opus', pending: null } });
    expect(events.of('agent:model', '71273').at(-1)).toMatchObject({ model: 'opus', pending: null });
    await sessions.dispose();
  });

  it('"Apply model now" interrupts, then sends a continue turn that runs on the new model', async () => {
    const { call, events, sessions } = await setup();
    await sessions.setModel('71273', 'sonnet');
    const applied = await sessions.applyModelNow('71273');
    expect(applied).toMatchObject({ ok: true, data: { pending: { model: 'sonnet' } } });
    expect(call.interrupts).toBe(1);
    await call.sentCount(2);
    expect(call.sent[1]?.message.content).toBe(APPLY_MODEL_NOW_MESSAGE);

    // The continue turn's first message clears the switch, whatever it reports.
    call.push(assistantFrom('claude-sonnet-5-5'));
    await eventually(() => events.of('agent:model', '71273').at(-1)?.['pending'] === null);
    // Nothing pending: Apply model now changes nothing.
    expect(await sessions.applyModelNow('71273')).toMatchObject({ ok: true, data: { model: 'sonnet', pending: null } });
    expect(call.interrupts).toBe(1);
    await sessions.dispose();
  });

  it('without a live session a change applies at once and is saved for the next start', async () => {
    const fake = createFakeClaude({ live: true, messages: [fakeInit('s')] });
    const claude = createClaudeLauncher({ executable: () => 'C:\\claude.exe', query: () => fake.query, baseEnv: () => ({}) });
    const tickets = await memoryTickets({ id: '71274', model: 'opus', effort: 'high' });
    const events = recordingEmit();
    const sessions = createSessionManager({ claude, connections: fakeClaudeConnections('login'), tickets, emit: events.emit });

    expect(await sessions.setModel('71274', 'sonnet')).toEqual({ ok: true, data: { ticketId: '71274', model: 'sonnet', effort: 'high', pending: null } });
    expect(await sessions.setEffort('71274', 'low')).toEqual({ ok: true, data: { ticketId: '71274', model: 'sonnet', effort: 'low', pending: null } });
    expect(await tickets.get('71274')).toMatchObject({ model: 'sonnet', effort: 'low' });
    expect(await sessions.applyModelNow('71274')).toMatchObject({ ok: false, code: 'VALIDATION' });

    await sessions.start({ ticketId: '71274', jobDescription: JOB });
    expect(fake.calls[0]?.options).toMatchObject({ model: 'claude-sonnet-5-5', effort: 'low' });
    await sessions.dispose();
  });
});
