import { join } from 'node:path';
import type { SDKMessage, SessionMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentOutputEvent } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { SessionMessageListener } from '../session-manager';
import { memoryTickets, recordingEmit, SESSION_TEST_BASE } from '../testing/sessions';
import { createTranscriptService } from './transcript';

const CWD = join(SESSION_TEST_BASE, '.agent-lanes', '71273');

function fakeSessions() {
  let listener: SessionMessageListener | undefined;
  return {
    subscribe: (next: SessionMessageListener) => {
      listener = next;
      return () => (listener = undefined);
    },
    deliver(ticketId: string, message: SDKMessage, resumed = false) {
      listener?.({ ticketId, cwd: CWD, resumed, message });
    },
    get listening() {
      return listener !== undefined;
    },
    get listener() {
      return listener;
    },
  };
}

function listenerOf(sessions: ReturnType<typeof fakeSessions>): SessionMessageListener {
  const found = sessions.listener;
  if (!found) throw new Error('No listener subscribed');
  return found;
}

let n = 0;
function text(content: string, messageId = `msg_${(n += 1)}`): SDKMessage {
  return {
    type: 'assistant',
    message: { id: messageId, role: 'assistant', content: [{ type: 'text', text: content }] },
    parent_tool_use_id: null,
    uuid: `uuid-${messageId}`,
    session_id: 's',
  } as unknown as SDKMessage;
}

function delta(messageId: string, chunk: string): SDKMessage[] {
  return [
    { type: 'stream_event', event: { type: 'message_start', message: { id: messageId } }, parent_tool_use_id: null, uuid: `se-${(n += 1)}`, session_id: 's' },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: chunk } }, parent_tool_use_id: null, uuid: `se-${(n += 1)}`, session_id: 's' },
  ] as unknown as SDKMessage[];
}

/** What a renderer does: keep events by seq, in seq order, without duplicates. */
function merge(...lists: AgentOutputEvent[][]): AgentOutputEvent[] {
  const bySeq = new Map<number, AgentOutputEvent>();
  for (const list of lists) for (const event of list) bySeq.set(event.seq, event);
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

async function setup(options: { capacity?: number; history?: (sessionId: string, dir: string) => Promise<SessionMessage[]> } = {}) {
  const sessions = fakeSessions();
  const tickets = await memoryTickets({ id: '71273' }, { id: '71274' });
  const events = recordingEmit();
  const transcripts = createTranscriptService({ sessions, tickets, emit: events.emit, now: () => 5, ...options });
  const emitted = () => events.of('agent:output') as unknown as AgentOutputEvent[];
  return { sessions, tickets, events, emitted, transcripts };
}

describe('transcript buffer (AL-102)', () => {
  it('numbers each ticket’s output from 1, pushes it as agent:output and keeps it for backfill', async () => {
    const { sessions, emitted, transcripts } = await setup();
    sessions.deliver('71273', text('one'));
    sessions.deliver('71274', text('other ticket'));
    sessions.deliver('71273', text('two'));

    expect(emitted().map((event) => [event.ticketId, event.seq, event.item.kind === 'text' ? event.item.text : ''])).toEqual([
      ['71273', 1, 'one'],
      ['71274', 1, 'other ticket'],
      ['71273', 2, 'two'],
    ]);
    const transcript = await transcripts.get('71273');
    expect(transcript.lastSeq).toBe(2);
    expect(transcript.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(transcript.events.every((event) => event.ticketId === '71273' && event.at === 5)).toBe(true);
  });

  it('drops streamed deltas from the buffer once their finished text arrives (they were still pushed live)', async () => {
    const { sessions, emitted, transcripts } = await setup();
    for (const message of delta('msg_x', 'Wiring the job grid')) sessions.deliver('71273', message);
    expect((await transcripts.get('71273')).events.map((event) => event.item.kind)).toEqual(['text-delta']);

    sessions.deliver('71273', text('Wiring the job grid filters', 'msg_x'));
    expect(emitted().map((event) => event.item.kind)).toEqual(['text-delta', 'text']);
    const transcript = await transcripts.get('71273');
    expect(transcript.events.map((event) => [event.seq, event.item.kind])).toEqual([[2, 'text']]);
    expect(transcript.lastSeq).toBe(2);
  });

  it('keeps the newest events up to its capacity', async () => {
    const { sessions, transcripts } = await setup({ capacity: 3 });
    for (let i = 0; i < 5; i += 1) sessions.deliver('71273', text(`line ${i}`));
    expect((await transcripts.get('71273')).events.map((event) => event.seq)).toEqual([3, 4, 5]);
  });

  it('a drill-in opened mid-run shows prior output, then continues live with no gap or duplicate', async () => {
    const { sessions, emitted, transcripts } = await setup();
    for (let i = 0; i < 4; i += 1) sessions.deliver('71273', text(`before ${i}`));

    // The drill-in subscribes, then asks for the transcript; output keeps arriving while it waits.
    const seenLive: AgentOutputEvent[] = [];
    const from = emitted().length;
    const backfill = transcripts.get('71273');
    sessions.deliver('71273', text('during'));
    const transcript = await backfill;
    sessions.deliver('71273', text('after'));
    seenLive.push(...emitted().slice(from));

    const shown = merge(transcript.events, seenLive);
    expect(shown.map((event) => event.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(shown.map((event) => (event.item.kind === 'text' ? event.item.text : ''))).toEqual(['before 0', 'before 1', 'before 2', 'before 3', 'during', 'after']);
  });

  it('adds a line from the app to the output', async () => {
    const { emitted, transcripts } = await setup();
    transcripts.appendSystem('71273', 'Plan approved by Kyle · moved to Implementing');
    expect(emitted()).toEqual([{ ticketId: '71273', at: 5, seq: 1, item: { kind: 'system', text: 'Plan approved by Kyle · moved to Implementing', parentToolUseId: null } }]);
  });
});

describe('transcript history after a restart (AL-102)', () => {
  const saved = (uuid: string, content: string): SessionMessage => ({
    type: 'assistant',
    uuid,
    session_id: 'session-before',
    message: { id: `m-${uuid}`, role: 'assistant', content: [{ type: 'text', text: content }] },
    parent_tool_use_id: null,
    parent_agent_id: null,
  });

  it('reads older output of a resumed session once, before the live output, without repeating what streamed', async () => {
    const history = vi.fn(async () => [saved('h1', 'from yesterday'), saved('h2', 'also old'), saved('uuid-live', 'streamed again')]);
    const { sessions, tickets, transcripts } = await setup({ history });
    await tickets.update('71273', (record) => ({ ...record, sessionId: 'session-before' }));

    sessions.deliver('71273', text('streamed again', 'live'), true);
    const transcript = await transcripts.get('71273');

    expect(history).toHaveBeenCalledExactlyOnceWith('session-before', (await tickets.get('71273'))?.worktreePath);
    expect(transcript.events.map((event) => [event.seq, event.item.kind === 'text' ? event.item.text : ''])).toEqual([
      [-1, 'from yesterday'],
      [0, 'also old'],
      [1, 'streamed again'],
    ]);
    expect(transcript.lastSeq).toBe(1);
    await transcripts.get('71273');
    expect(history).toHaveBeenCalledOnce();
  });

  it('reads no history for a session that started fresh, and retries a failed read', async () => {
    const history = vi.fn(async (): Promise<SessionMessage[]> => {
      throw new Error('EBUSY');
    });
    const { sessions, tickets, transcripts } = await setup({ history });
    sessions.deliver('71273', text('first words'));
    await transcripts.get('71273');
    expect(history).not.toHaveBeenCalled();

    await tickets.update('71274', (record) => ({ ...record, sessionId: 'session-74' }));
    await transcripts.get('71274');
    await transcripts.get('71274');
    expect(history).toHaveBeenCalledTimes(2);
  });

  it('stops listening on dispose', async () => {
    const { sessions, transcripts } = await setup();
    expect(sessions.listening).toBe(true);
    transcripts.dispose();
    expect(sessions.listening).toBe(false);
  });
});

describe('what the app sent the session (AL-251)', () => {
  it("shows the user's sent messages as user items and leaves the app's own turns out", async () => {
    const { sessions, emitted } = await setup();
    const message = { type: 'user', message: { role: 'user', content: 'full first turn' }, parent_tool_use_id: null, uuid: 'u1', session_id: 's' } as unknown as SDKMessage;
    const send = (sent: NonNullable<Parameters<SessionMessageListener>[0]['sent']>) =>
      listenerOf(sessions)({ ticketId: '71273', cwd: CWD, resumed: false, message, sent });
    send({ messageId: 'u1', text: 'Cut it over', priority: 'next', source: 'launch', held: false });
    send({ messageId: 'u2', text: 'Continue where you left off.', priority: 'next', source: 'app', held: false });
    send({ messageId: 'u3', text: '/code-review', priority: 'now', source: 'skill', held: true });

    expect(emitted().map((event) => event.item)).toEqual([
      { kind: 'user', messageId: 'u1', text: 'Cut it over', priority: 'next', source: 'launch', parentToolUseId: null },
      { kind: 'user', messageId: 'u3', text: '/code-review', priority: 'now', source: 'skill', parentToolUseId: null },
    ]);
  });
});
