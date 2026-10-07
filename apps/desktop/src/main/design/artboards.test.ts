import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ok, type TicketRecord } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { createClaudeLauncher } from '../agent/claude-sdk';
import { createFakeClaude, fakeErrorResult, fakeResult, type FakeClaudeScript } from '../agent/testing/fake-claude';
import { CLAUDE_DESIGN_READ_OPERATIONS, UNAVAILABLE_REASON, artboardPrompt, createDesignArtboardReader } from './artboards';

const PROJECT = { kind: 'design-project' as const, id: 'p-71273', url: 'https://claude.ai/design/p/p-71273' };
const ARTIFACT = { kind: 'artifact' as const, id: 'art-2', url: 'https://claude.ai/artifact/art-2' };

const ARTBOARDS = [
  { id: 'job-control.html', name: 'JobControl · desktop', width: 1440, height: 900 },
  { id: 'job-filter.html', name: 'JobFilter · side panel', width: 420, height: 900 },
  { id: 'empty.html', name: 'Empty state', width: null, height: null },
];

function init(tools: string[]): SDKMessage {
  return { type: 'system', subtype: 'init', tools, session_id: 's', uuid: 'u' } as unknown as SDKMessage;
}

function structured(output: unknown): SDKMessage {
  return { ...fakeResult(), structured_output: output } as unknown as SDKMessage;
}

function setup(script: FakeClaudeScript, canvas: TicketRecord['design']['canvas'] = PROJECT) {
  const fake = createFakeClaude(script);
  const claude = createClaudeLauncher({ executable: () => 'claude', query: () => fake.query, baseEnv: () => ({}) });
  const tickets = { get: vi.fn(async (id: string) => (id === '71273' ? ({ design: { canvas } } as unknown as TicketRecord) : undefined)) };
  const reader = createDesignArtboardReader({ claude, tickets, now: () => 5_000 });
  return { fake, reader };
}

describe('design artboard reader', () => {
  it('lists a Design project’s artboards through a read-only ClaudeDesign session on the claude.ai login', async () => {
    const { fake, reader } = setup({ messages: [init(['ClaudeDesign']), structured({ artboards: ARTBOARDS })] });

    expect(await reader.list('71273')).toEqual(ok({ status: 'ok', artboards: ARTBOARDS, readAt: 5_000 }));

    const call = fake.calls[0]!;
    expect(call.options).toMatchObject({ model: 'claude-haiku-4-5', tools: ['ClaudeDesign'], persistSession: false, settingSources: [] });
    expect(call.options.outputFormat).toMatchObject({ type: 'json_schema' });
    expect(call.options.env?.['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(call.prompt).toContain('"p-71273"');
    expect(call.closed).toBe(true);
  });

  it('reads a Design artifact with the Artifact tool', async () => {
    const { fake, reader } = setup({ messages: [init(['Artifact']), structured({ artboards: [] })] }, ARTIFACT);
    expect(await reader.list('71273')).toEqual(ok({ status: 'ok', artboards: [], readAt: 5_000 }));
    expect(fake.calls[0]?.options.tools).toEqual(['Artifact']);
    expect(artboardPrompt(ARTIFACT)).toContain(ARTIFACT.url);
  });

  it('allows only read operations of the design tool', async () => {
    const { fake, reader } = setup({ messages: [init(['ClaudeDesign']), structured({ artboards: [] })] });
    await reader.list('71273');
    const canUseTool = fake.calls[0]!.options.canUseTool!;
    const signal = new AbortController().signal;

    for (const operation of CLAUDE_DESIGN_READ_OPERATIONS) {
      expect(await canUseTool('ClaudeDesign', { operation }, { signal, toolUseID: 't' } as never)).toMatchObject({ behavior: 'allow' });
    }
    for (const operation of ['write_files', 'finalize_plan', 'delete_files', 'update_sharing']) {
      expect(await canUseTool('ClaudeDesign', { operation }, { signal, toolUseID: 't' } as never)).toMatchObject({ behavior: 'deny' });
    }
    expect(await canUseTool('Bash', { command: 'dir' }, { signal, toolUseID: 't' } as never)).toMatchObject({ behavior: 'deny' });
  });

  it('says Claude Design is unavailable when the login does not offer the tool (D119)', async () => {
    const { fake, reader } = setup({ messages: [init(['Read']), structured({ artboards: ARTBOARDS })] });
    expect(await reader.list('71273')).toEqual(ok({ status: 'unavailable', reason: UNAVAILABLE_REASON }));
    expect(fake.calls[0]?.closed).toBe(true);
  });

  it('reports no canvas without starting a session', async () => {
    const { fake, reader } = setup({ messages: [] }, null);
    expect(await reader.list('71273')).toEqual(ok({ status: 'no-canvas' }));
    expect(await reader.list('99999')).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(fake.calls).toHaveLength(0);
  });

  it('reports a failed session, a reply that is not a list, and a stream that dies', async () => {
    expect(await setup({ messages: [init(['ClaudeDesign']), fakeErrorResult('error_max_turns')] }).reader.list('71273')).toMatchObject({
      ok: false,
      code: 'INTERNAL',
      message: expect.stringContaining('error_max_turns'),
    });
    expect(await setup({ messages: [init(['ClaudeDesign']), structured({ boards: [] })] }).reader.list('71273')).toMatchObject({
      ok: false,
      code: 'INTERNAL',
    });
    expect(await setup({ messages: [init(['ClaudeDesign'])], failWith: new Error('process exited') }).reader.list('71273')).toMatchObject({
      ok: false,
      message: expect.stringContaining('process exited'),
    });
  });

  it('keeps the first artboard of each id', async () => {
    const twice = [ARTBOARDS[0]!, { ...ARTBOARDS[0]!, name: 'Again' }];
    const { reader } = setup({ messages: [init(['ClaudeDesign']), structured({ artboards: twice })] });
    expect(await reader.list('71273')).toEqual(ok({ status: 'ok', artboards: [ARTBOARDS[0]], readAt: 5_000 }));
  });

  it('stops a session that takes too long', async () => {
    vi.useFakeTimers();
    try {
      const fake = createFakeClaude({ messages: [init(['ClaudeDesign'])], hang: true });
      const claude = createClaudeLauncher({ executable: () => 'claude', query: () => fake.query, baseEnv: () => ({}) });
      const tickets = { get: vi.fn(async () => ({ design: { canvas: PROJECT } }) as unknown as TicketRecord) };
      const reading = createDesignArtboardReader({ claude, tickets, timeoutMs: 1_000 }).list('71273');
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await reading).toMatchObject({ ok: false, message: 'Reading the artboards took too long.' });
    } finally {
      vi.useRealTimers();
    }
  });
});
