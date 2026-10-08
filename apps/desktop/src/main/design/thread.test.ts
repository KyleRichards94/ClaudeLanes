import { join } from 'node:path';
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { ok, type DesignThread, type DesignThreadEvent, type TicketRecord } from '@agent-lanes/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClaudeLauncher, type ClaudeQuery, type ClaudeQueryFunction } from '../agent/claude-sdk';
import { createSessionManager } from '../agent/session-manager';
import { createFakeClaude, fakeAssistant, fakeErrorResult, fakeInit, fakeResult } from '../agent/testing/fake-claude';
import { eventually, fakeClaudeConnections, memoryTickets, recordingEmit } from '../agent/testing/sessions';
import { createMemoryRecordFs, type MemoryRecordFs } from '../tickets/testing';
import { UNAVAILABLE_REASON } from './artboards';
import { DESIGN_THREAD_MODEL, createDesignThreadService, designThreadsDir, threadPrompt, type DesignThreadService } from './thread';

const PROJECT = { kind: 'design-project' as const, id: 'p-71273', url: 'https://claude.ai/design/p/p-71273' };
const OTHER = { kind: 'design-project' as const, id: 'p-other', url: 'https://claude.ai/design/p/p-other' };
const ARTIFACT = { kind: 'artifact' as const, id: 'art-2', url: 'https://claude.ai/artifact/art-2' };
const DIR = designThreadsDir(join('C:', 'data'));

function init(tools: string[], sessionId: string): SDKMessage {
  return { type: 'system', subtype: 'init', tools, session_id: sessionId, uuid: 'u' } as unknown as SDKMessage;
}

interface Call {
  options: Options;
  sent: string[];
  closed: boolean;
}

type Responder = (text: string, call: Call) => AsyncIterable<SDKMessage> | Iterable<SDKMessage>;

/**
 * A `claude` stand-in that answers each message written to it, the way a streaming-input session
 * does: `system/init`, then what `respond` yields for that message. Nothing leaves the machine.
 */
function interactiveClaude(respond: Responder, tools: string[] = ['ClaudeDesign', 'Artifact']) {
  const calls: Call[] = [];
  let sessions = 0;
  const query: ClaudeQueryFunction = ({ prompt, options = {} }) => {
    const call: Call = { options, sent: [], closed: false };
    calls.push(call);
    sessions += 1;
    const sessionId = options.resume ?? `design-session-${sessions}`;
    async function* stream(): AsyncGenerator<SDKMessage, void> {
      for await (const message of prompt as AsyncIterable<SDKUserMessage>) {
        if (call.closed) return;
        const text = String(message.message.content);
        call.sent.push(text);
        yield init(tools, sessionId);
        for await (const reply of respond(text, call)) yield reply;
      }
    }
    return Object.assign(stream(), {
      accountInfo: async () => ({}),
      close: () => {
        call.closed = true;
      },
      interrupt: async () => undefined,
      setModel: async () => undefined,
      applyFlagSettings: async () => undefined,
      mcpServerStatus: async () => [],
      reconnectMcpServer: async () => undefined,
    }) as ClaudeQuery;
  };
  return { query, calls };
}

const echo: Responder = (text) => [fakeAssistant(`Looked at the canvas: ${text}`), fakeResult({ result: 'done' })];

function ticket(canvas: TicketRecord['design']['canvas'] = PROJECT): TicketRecord {
  return { id: '71273', title: 'Cutover frmJobControl to Blazor', design: { canvas, lastViewUrl: null, specs: [] } } as unknown as TicketRecord;
}

const services: DesignThreadService[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) await service.dispose();
});

function setup(query: ClaudeQueryFunction, options: { fs?: MemoryRecordFs; record?: () => TicketRecord | undefined } = {}) {
  const fs = options.fs ?? createMemoryRecordFs();
  const events: DesignThreadEvent[] = [];
  const claude = createClaudeLauncher({ executable: () => 'claude', query: () => query, baseEnv: () => ({ ANTHROPIC_API_KEY: 'sk-inherited' }) });
  const record = options.record ?? (() => ticket());
  let id = 0;
  const service = createDesignThreadService({
    claude,
    tickets: { get: vi.fn(async (ticketId: string) => (ticketId === '71273' ? record() : undefined)) },
    emit: ((channel: string, payload: Omit<DesignThreadEvent, 'at'>) => {
      if (channel === 'design:thread') events.push({ ...payload, at: 0 });
    }) as never,
    dir: DIR,
    fs,
    now: () => 1_000,
    newId: () => `m${(id += 1)}`,
  });
  services.push(service);
  return { service, fs, events, claude };
}

/** The thread once `predicate` holds for the latest `design:thread` event. */
async function until(events: DesignThreadEvent[], predicate: (thread: DesignThread) => boolean): Promise<DesignThread> {
  await vi.waitFor(() => expect(events.some((event) => predicate(event.thread))).toBe(true));
  return events.findLast((event) => predicate(event.thread))!.thread;
}

describe('design thread', () => {
  it('sends a message to the ticket’s own design session and adds its reply to the thread', async () => {
    const fake = interactiveClaude(echo);
    const { service, events } = setup(fake.query);

    const sent = await service.send('71273', 'Make the filter panel narrower');
    expect(sent).toMatchObject({ ok: true, data: { status: 'replying', messages: [{ role: 'user', text: 'Make the filter panel narrower' }] } });

    const thread = await until(events, (t) => t.status === 'idle');
    expect(thread.messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'Make the filter panel narrower'],
      ['design', 'Looked at the canvas: Make the filter panel narrower'],
    ]);

    const options = fake.calls[0]!.options;
    expect(options).toMatchObject({ model: DESIGN_THREAD_MODEL, tools: ['ClaudeDesign'], cwd: DIR, settingSources: [] });
    expect(options.resume).toBeUndefined();
    // The claude.ai login, never an inherited API key (D115).
    expect(options.env?.['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(String(options.systemPrompt)).toContain('"p-71273"');
  });

  it('keeps one session per ticket and answers several messages in order', async () => {
    const fake = interactiveClaude(echo);
    const { service, events } = setup(fake.query);

    await service.send('71273', 'one');
    await service.send('71273', 'two');
    const thread = await until(events, (t) => t.status === 'idle' && t.messages.length === 4);

    expect(fake.calls).toHaveLength(1);
    expect(thread.messages.map((m) => m.text)).toEqual(['one', 'two', 'Looked at the canvas: one', 'Looked at the canvas: two']);
  });

  it('talks to an artifact canvas through the Artifact tool', async () => {
    const fake = interactiveClaude(echo);
    const { service, events } = setup(fake.query, { record: () => ticket(ARTIFACT) });
    await service.send('71273', 'hi');
    await until(events, (t) => t.status === 'idle');
    expect(fake.calls[0]!.options.tools).toEqual(['Artifact']);
    expect(threadPrompt(ticket(ARTIFACT), ARTIFACT)).toContain(ARTIFACT.url);
  });

  it('keeps working while another Claude session (the lead agent) is mid-turn, without touching it', async () => {
    // The lead agent: a session that streams and never finishes its turn.
    const lead = createFakeClaude({ messages: [fakeAssistant('Editing JobGrid.razor…')], hang: true });
    const design = interactiveClaude(echo);
    const query: ClaudeQueryFunction = (params) => (Array.isArray(params.options?.tools) && params.options.tools.includes('ClaudeDesign') ? design.query(params) : lead.query(params));
    const { service, events, claude } = setup(query);

    const leadQuery = await claude.launch({ credential: { mode: 'login' }, prompt: 'Implement the plan' });
    const leadIterator = leadQuery[Symbol.asyncIterator]();
    expect((await leadIterator.next()).value).toMatchObject({ type: 'assistant' });

    await service.send('71273', 'Is the header sticky?');
    await until(events, (t) => t.status === 'idle' && t.messages.length === 2);

    // Nothing reached the lead agent's session, and it is still running.
    expect(lead.calls[0]).toMatchObject({ prompt: 'Implement the plan', sent: [], closed: false });
    leadQuery.close();
  });

  it('answers while the session manager’s lead agent is mid-turn, and the agent’s output keeps streaming', async () => {
    // The lead agent (AL-100): a live session that has started its turn and not finished it.
    const lead = createFakeClaude({ live: true, messages: [fakeInit('lead-session'), fakeAssistant('Editing JobGrid.razor…')] });
    const leadClaude = createClaudeLauncher({ executable: () => 'claude', query: () => lead.query, baseEnv: () => ({}) });
    const sessions = createSessionManager({
      claude: leadClaude,
      connections: fakeClaudeConnections('login'),
      tickets: await memoryTickets({ id: '71273' }),
      emit: recordingEmit().emit,
    });
    // What the session streams; the transcript service turns these into `agent:output` (AL-102).
    const streamed: SDKMessage[] = [];
    sessions.subscribe((event) => {
      if (event.ticketId === '71273') streamed.push(event.message);
    });
    const design = interactiveClaude(echo);
    const { service, events } = setup(design.query);

    expect(await sessions.start({ ticketId: '71273', jobDescription: 'Implement the plan' })).toMatchObject({ ok: true });
    await eventually(() => streamed.some((message) => message.type === 'assistant'));

    await service.send('71273', 'Is the header sticky?');
    const thread = await until(events, (t) => t.status === 'idle' && t.messages.length === 2);
    expect(thread.messages[1]).toMatchObject({ role: 'design', text: 'Looked at the canvas: Is the header sticky?' });

    // The agent's turn carries on streaming, and only its own first turn ever reached it.
    const before = streamed.length;
    lead.calls[0]!.push(fakeAssistant('Still editing JobGrid.razor…'));
    await eventually(() => streamed.length > before);
    expect(lead.calls[0]!.sent).toHaveLength(1);
    expect(String(lead.calls[0]!.sent[0]!.message.content)).not.toContain('Is the header sticky?');
    expect(design.calls[0]!.sent).toEqual(['Is the header sticky?']);
    await sessions.dispose();
  });

  it('saves the history and resumes the same design session after a restart', async () => {
    const fs = createMemoryRecordFs();
    const first = setup(interactiveClaude(echo).query, { fs });
    await first.service.send('71273', 'Before the restart');
    await until(first.events, (t) => t.status === 'idle');
    await first.service.dispose();

    const saved = JSON.parse(fs.files.get(join(DIR, '71273.json'))!) as { sessionId: string; messages: unknown[] };
    expect(saved).toMatchObject({ sessionId: 'design-session-1', canvasUrl: PROJECT.url });
    expect(saved.messages).toHaveLength(2);

    const fake = interactiveClaude(echo);
    const second = setup(fake.query, { fs });
    const thread = await second.service.get('71273');
    expect(thread).toMatchObject({ ok: true, data: { status: 'idle', approval: null } });
    expect(thread.ok && thread.data.messages.map((m) => m.text)).toEqual(['Before the restart', 'Looked at the canvas: Before the restart']);

    await second.service.send('71273', 'After the restart');
    await until(second.events, (t) => t.status === 'idle' && t.messages.length === 4);
    expect(fake.calls[0]!.options.resume).toBe('design-session-1');
  });

  it('starts a new session, keeping the history, when the ticket is linked to another canvas', async () => {
    let canvas = PROJECT;
    const fake = interactiveClaude(echo);
    const { service, events } = setup(fake.query, { record: () => ticket(canvas) });
    await service.send('71273', 'first canvas');
    await until(events, (t) => t.status === 'idle');

    canvas = OTHER;
    await service.send('71273', 'second canvas');
    await until(events, (t) => t.status === 'idle' && t.messages.length === 4);

    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]!.closed).toBe(true);
    expect(fake.calls[1]!.options.resume).toBeUndefined();
    expect(String(fake.calls[1]!.options.systemPrompt)).toContain('"p-other"');
  });

  it('is unavailable, with the reason, when the Claude login has no Claude Design (D119)', async () => {
    const fake = interactiveClaude(echo, []);
    const { service, events } = setup(fake.query);
    await service.send('71273', 'hello');
    const thread = await until(events, (t) => t.status === 'unavailable');
    expect(thread.reason).toBe(UNAVAILABLE_REASON);
    expect(fake.calls[0]!.closed).toBe(true);
    expect(await service.get('71273')).toMatchObject({ ok: true, data: { status: 'unavailable' } });
  });

  it('is unavailable when Claude Code cannot start', async () => {
    const claudeMissing = createClaudeLauncher({ executable: () => null });
    const fs = createMemoryRecordFs();
    const events: DesignThreadEvent[] = [];
    const service = createDesignThreadService({
      claude: claudeMissing,
      tickets: { get: async () => ticket() },
      emit: ((_channel: string, payload: Omit<DesignThreadEvent, 'at'>) => events.push({ ...payload, at: 0 })) as never,
      dir: DIR,
      fs,
    });
    services.push(service);
    await service.send('71273', 'hello');
    const thread = await until(events, (t) => t.status === 'unavailable');
    expect(thread.reason).toContain("Claude Code isn't installed");
    expect(thread.messages.at(-1)).toMatchObject({ role: 'notice', error: true });
  });

  it('notes a failed turn and a session that stopped, and starts a new session on the next message', async () => {
    let turn = 0;
    const fake = interactiveClaude(function* () {
      turn += 1;
      if (turn === 1) yield fakeErrorResult('error_during_execution');
      else if (turn === 2) throw new Error('process exited');
      else yield* [fakeAssistant('Back again'), fakeResult()];
    });
    const { service, events } = setup(fake.query);

    await service.send('71273', 'one');
    await until(events, (t) => t.messages.some((m) => m.text.includes('error_during_execution')));
    await service.send('71273', 'two');
    const stopped = await until(events, (t) => t.messages.some((m) => m.text.startsWith('The design session stopped')));
    expect(stopped.status).toBe('idle');
    expect(stopped.messages.at(-1)).toMatchObject({ role: 'notice', error: true });

    await service.send('71273', 'three');
    await until(events, (t) => t.messages.some((m) => m.text === 'Back again'));
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[1]!.options.resume).toBe('design-session-1');
  });

  it('needs a linked canvas and a known ticket', async () => {
    const { service } = setup(interactiveClaude(echo).query, { record: () => ticket(null) });
    expect(await service.send('71273', 'hi')).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(await service.get('71273')).toMatchObject({ ok: true, data: { status: 'no-canvas', messages: [] } });
    expect(await service.get('99999')).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('sets aside a thread file it cannot read and starts empty', async () => {
    const fs = createMemoryRecordFs();
    await fs.mkdir(DIR);
    fs.files.set(join(DIR, '71273.json'), '{ not json');
    const { service } = setup(interactiveClaude(echo).query, { fs });
    expect(await service.get('71273')).toMatchObject({ ok: true, data: { messages: [] } });
    expect([...fs.files.keys()].some((file) => file.includes('71273.corrupt-'))).toBe(true);
  });

  describe('canvas changes (D121)', () => {
    async function canUseTool(fake: ReturnType<typeof interactiveClaude>, events: DesignThreadEvent[], service: DesignThreadService) {
      await service.send('71273', 'look');
      await until(events, (t) => t.status === 'idle');
      return fake.calls[0]!.options.canUseTool!;
    }
    const ctx = (signal = new AbortController().signal) => ({ signal, toolUseID: 't' }) as never;

    it('allows reads, and writes carrying an approved plan’s token, without asking', async () => {
      const fake = interactiveClaude(echo);
      const { service, events } = setup(fake.query);
      const check = await canUseTool(fake, events, service);

      expect(await check('ClaudeDesign', { operation: 'read_file', arguments: { path: 'a.html' } }, ctx())).toMatchObject({ behavior: 'allow' });
      expect(await check('ClaudeDesign', { operation: 'write_files', arguments: { plan_token: 'pt-1' } }, ctx())).toMatchObject({ behavior: 'allow' });
      expect(await check('Artifact', { action: 'read', url: ARTIFACT.url }, ctx())).toMatchObject({ behavior: 'deny' });
      expect(await check('Bash', { command: 'ls' }, ctx())).toMatchObject({ behavior: 'deny' });
    });

    it('asks the user to approve a plan in the thread, and allows it when approved', async () => {
      const fake = interactiveClaude(echo);
      const { service, events } = setup(fake.query);
      const check = await canUseTool(fake, events, service);

      const decision = check('ClaudeDesign', { operation: 'finalize_plan', arguments: { plan: 'Narrow JobFilter to 360 px' } }, ctx());
      const waiting = await until(events, (t) => t.approval !== null);
      expect(waiting.approval).toMatchObject({ operation: 'finalize_plan' });
      expect(waiting.approval!.summary).toContain('Narrow JobFilter to 360 px');

      // A second change while one waits is refused, not queued.
      expect(await check('ClaudeDesign', { operation: 'finalize_plan', arguments: {} }, ctx())).toMatchObject({ behavior: 'deny' });

      expect(await service.answer('71273', 'wrong-id', true)).toMatchObject({ ok: false, code: 'VALIDATION' });
      expect(await service.answer('71273', waiting.approval!.id, true)).toMatchObject({ ok: true, data: { approval: null } });
      expect(await decision).toMatchObject({ behavior: 'allow' });
      const thread = await until(events, (t) => t.messages.some((m) => m.text === 'You approved finalize_plan.'));
      expect(thread.approval).toBeNull();
    });

    it('denies the change when the user declines it, or when the session stops', async () => {
      const fake = interactiveClaude(echo);
      const { service, events } = setup(fake.query);
      const check = await canUseTool(fake, events, service);

      const declined = check('ClaudeDesign', { operation: 'delete_files', arguments: { paths: ['a.html'] } }, ctx());
      const waiting = await until(events, (t) => t.approval !== null);
      await service.answer('71273', waiting.approval!.id, false);
      expect(await declined).toMatchObject({ behavior: 'deny' });

      const aborted = new AbortController();
      const stopped = check('ClaudeDesign', { operation: 'finalize_plan', arguments: {} }, ctx(aborted.signal));
      await until(events, (t) => t.approval !== null && t.approval.id !== waiting.approval!.id);
      aborted.abort();
      expect(await stopped).toMatchObject({ behavior: 'deny' });
    });

    it('asks before an Artifact change on an artifact canvas', async () => {
      const fake = interactiveClaude(echo);
      const { service, events } = setup(fake.query, { record: () => ticket(ARTIFACT) });
      const check = await canUseTool(fake, events, service);

      expect(await check('Artifact', { action: 'read', url: ARTIFACT.url }, ctx())).toMatchObject({ behavior: 'allow' });
      const publish = check('Artifact', { file_path: 'a.html' }, ctx());
      const waiting = await until(events, (t) => t.approval !== null);
      expect(waiting.approval).toMatchObject({ operation: 'publish' });
      await service.answer('71273', waiting.approval!.id, true);
      expect(await publish).toMatchObject({ behavior: 'allow' });
    });
  });

  it('stops every session on dispose and keeps the history on disk', async () => {
    const fake = interactiveClaude(async function* () {
      yield fakeAssistant('thinking…');
      await new Promise(() => undefined);
    });
    const { service, events, fs } = setup(fake.query);
    await service.send('71273', 'long one');
    await until(events, (t) => t.messages.length === 2);
    await service.dispose();
    expect(fake.calls[0]!.closed).toBe(true);
    expect(JSON.parse(fs.files.get(join(DIR, '71273.json'))!).messages).toHaveLength(2);
    expect(await service.send('71273', 'after')).toMatchObject({ ok: false });
  });

  it('get returns ok for a ticket with no history yet', async () => {
    const { service } = setup(interactiveClaude(echo).query);
    expect(await service.get('71273')).toEqual(ok({ ticketId: '71273', status: 'idle', reason: null, messages: [], approval: null }));
  });
});
