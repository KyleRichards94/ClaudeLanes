import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it, vi } from 'vitest';
import { createClaudeLauncher } from '../agent/claude-sdk';
import { createFakeClaude, fakeErrorResult, fakeResult, type FakeClaudeScript } from '../agent/testing/fake-claude';
import { artboardSourcePrompt, createArtboardSourceReader } from './artboard-sources';

const PROJECT = { kind: 'design-project' as const, id: 'p-71273', url: 'https://claude.ai/design/p/p-71273' };
const IDS = ['JobControl.html', 'JobFilter.html'];

function init(tools: string[]): SDKMessage {
  return { type: 'system', subtype: 'init', tools, session_id: 's', uuid: 'u' } as unknown as SDKMessage;
}

function structured(output: unknown): SDKMessage {
  return { ...fakeResult(), structured_output: output } as unknown as SDKMessage;
}

function setup(script: FakeClaudeScript) {
  const fake = createFakeClaude(script);
  const warn = vi.fn();
  const reader = createArtboardSourceReader({ claude: createClaudeLauncher({ executable: () => 'claude', query: () => fake.query, baseEnv: () => ({}) }), warn });
  return { fake, reader, warn };
}

describe('artboard sources for a shipped spec (AL-197)', () => {
  it('reads each picked artboard with a read-only design session on the claude.ai login', async () => {
    const { fake, reader } = setup({
      messages: [init(['ClaudeDesign']), structured({ files: [{ id: 'JobControl.html', source: '<main/>' }, { id: 'JobFilter.html', source: null }, { id: 'other.html', source: 'x' }] })],
    });
    const sources = await reader.read(PROJECT, IDS);
    expect([...sources]).toEqual([
      ['JobControl.html', '<main/>'],
      ['JobFilter.html', null],
    ]);
    const call = fake.calls[0]!;
    expect(call.options).toMatchObject({ model: 'claude-haiku-4-5', tools: ['ClaudeDesign'], persistSession: false });
    expect(call.prompt).toBe(artboardSourcePrompt(PROJECT, IDS));
    const signal = new AbortController().signal;
    await expect(call.options.canUseTool!('ClaudeDesign', { operation: 'write_files' }, { signal, toolUseID: 't' } as never)).resolves.toMatchObject({ behavior: 'deny' });
    await expect(call.options.canUseTool!('ClaudeDesign', { operation: 'read_file' }, { signal, toolUseID: 't' } as never)).resolves.toMatchObject({ behavior: 'allow' });
    expect(call.closed).toBe(true);
  });

  it('never fails the ship: no Design access, a failed session or a bad reply leave the sources empty', async () => {
    for (const messages of [[init(['Read'])], [init(['ClaudeDesign']), fakeErrorResult('error_during_execution')], [init(['ClaudeDesign']), structured({ nope: true })]]) {
      const { reader, warn } = setup({ messages });
      const sources = await reader.read(PROJECT, IDS);
      expect([...sources.values()]).toEqual([null, null]);
      expect(warn).toHaveBeenCalledOnce();
    }
  });
});
