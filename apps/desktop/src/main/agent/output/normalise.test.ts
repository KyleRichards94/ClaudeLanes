import { join } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentOutputItem } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { buildCounts, createOutputNormaliser, firstLine, formatLineChange, lineChange } from './normalise';

/**
 * AL-102: SDK messages shaped as Claude Code 0.3.292 streams them (one content block per assistant
 * message, tool results as user messages with `tool_use_result`), turned into output items.
 */

const WORKTREE = join('C:', 'src', '.agent-lanes', '71273');
const ids = { session_id: 'session-a' };
let uuid = 0;
const nextUuid = () => `00000000-0000-4000-8000-${String((uuid += 1)).padStart(12, '0')}`;

function assistant(messageId: string, block: Record<string, unknown>, parent: string | null = null): SDKMessage {
  return {
    type: 'assistant',
    message: { id: messageId, type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [block], stop_reason: null, stop_sequence: null, usage: {} },
    parent_tool_use_id: parent,
    uuid: nextUuid(),
    ...ids,
  } as unknown as SDKMessage;
}

function toolUse(messageId: string, id: string, name: string, input: Record<string, unknown>, parent: string | null = null): SDKMessage {
  return assistant(messageId, { type: 'tool_use', id, name, input }, parent);
}

function toolResult(id: string, content: string, structured?: unknown, isError = false): SDKMessage {
  return {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
    parent_tool_use_id: null,
    tool_use_result: structured,
    uuid: nextUuid(),
    ...ids,
  } as unknown as SDKMessage;
}

function streamEvent(event: Record<string, unknown>): SDKMessage {
  return { type: 'stream_event', event, parent_tool_use_id: null, uuid: nextUuid(), ...ids } as unknown as SDKMessage;
}

type ToolItem = Extract<AgentOutputItem, { kind: 'tool' }>;
interface Row {
  label: string;
  detail: string;
  stats: string | null;
}

/** Folds tool and tool-result items into rows, as the Output tab does (a later tool item replaces its row). */
function rows(items: AgentOutputItem[]): Row[] {
  const byId = new Map<string, Row>();
  for (const item of items) {
    if (item.kind === 'tool') byId.set(item.rowId, { label: item.label, detail: item.detail, stats: item.stats ?? byId.get(item.rowId)?.stats ?? null });
    if (item.kind === 'tool-result' && item.stats !== null) {
      const row = byId.get(item.rowId);
      if (row) row.stats = item.stats;
    }
  }
  return [...byId.values()];
}

const plus = (count: number) => Array.from({ length: count }, (_, i) => `+  <td>column ${i}</td>`);

describe('output normalisation: artboard 3 tool rows from SDK messages', () => {
  it('produces the Read, Spawn, Edit and Bash rows exactly as drawn', () => {
    const normaliser = createOutputNormaliser({ cwd: WORKTREE, platform: 'win32' });
    const formPath = join(WORKTREE, 'OnSite', 'Forms', 'frmJobControl.vb');
    const razorPath = join(WORKTREE, 'Pages', 'Jobs', 'JobControl.razor');
    const messages: SDKMessage[] = [
      toolUse('msg_01', 'toolu_read', 'Read', { file_path: formPath }),
      toolResult('toolu_read', '     1→Public Class frmJobControl\n     2→...', {
        type: 'text',
        file: { filePath: formPath, content: '…', numLines: 1842, startLine: 1, totalLines: 1842 },
      }),
      assistant('msg_02', { type: 'text', text: "frmJobControl opens 4 child modals. I'm cutting over **frmJobFilter** with the parent." }),
      // Three sub-agents started in one assistant message (streamed as one block per message, same message id).
      toolUse('msg_03', 'toolu_a1', 'Agent', { description: 'Map child modals', prompt: '…', subagent_type: 'explore', name: 'explore' }),
      toolUse('msg_03', 'toolu_a2', 'Agent', { description: 'Razor templates', prompt: '…', subagent_type: 'general-purpose', name: 'razor-writer' }),
      toolUse('msg_03', 'toolu_a3', 'Agent', { description: 'bUnit tests', prompt: '…', subagent_type: 'general-purpose', name: 'test-writer' }),
      toolUse('msg_04', 'toolu_edit', 'Edit', { file_path: razorPath, old_string: '@page "/jobs"', new_string: '@page "/jobs"\n<table>' }),
      toolResult('toolu_edit', `The file ${razorPath} has been updated.`, {
        filePath: razorPath,
        oldString: '',
        newString: '',
        originalFile: '',
        structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 215, lines: [' @page "/jobs"', ...plus(214)] }],
        userModified: false,
        replaceAll: false,
      }),
      toolUse('msg_05', 'toolu_bash', 'Bash', { command: 'dotnet build OnSite.Blazor.csproj', description: 'Build the Blazor project' }),
      toolResult('toolu_bash', 'Build succeeded.', {
        stdout: 'Build succeeded.\n    2 Warning(s)\n    0 Error(s)\n\nTime Elapsed 00:00:14.21',
        stderr: '',
        interrupted: false,
      }),
    ];
    const items = messages.flatMap((message) => normaliser.normalise(message));

    expect(rows(items)).toEqual([
      { label: 'Read', detail: 'OnSite/Forms/frmJobControl.vb', stats: '1,842 lines' },
      { label: 'Spawn', detail: 'explore · razor-writer · test-writer', stats: '3 sub-agents' },
      { label: 'Edit', detail: 'Pages/Jobs/JobControl.razor', stats: '+214 −0' },
      { label: 'Bash', detail: 'dotnet build OnSite.Blazor.csproj', stats: '0 errors · 2 warnings' },
    ]);
    expect(items.filter((item) => item.kind === 'text')).toEqual([
      { kind: 'text', streamId: 'msg_02', text: "frmJobControl opens 4 child modals. I'm cutting over **frmJobFilter** with the parent.", parentToolUseId: null },
    ]);
    // The Spawn row grows as each sub-agent is started; every update keeps the same row id.
    const spawn = items.filter((item): item is ToolItem => item.kind === 'tool' && item.tool === 'spawn');
    expect(spawn.map((item) => [item.rowId, item.toolUseIds.length, item.stats])).toEqual([
      ['spawn:toolu_a1', 1, '1 sub-agent'],
      ['spawn:toolu_a1', 2, '2 sub-agents'],
      ['spawn:toolu_a1', 3, '3 sub-agents'],
    ]);
  });

  it('streams text deltas into the message they belong to (the line with the caret)', () => {
    const normaliser = createOutputNormaliser({ cwd: WORKTREE });
    const items = [
      streamEvent({ type: 'message_start', message: { id: 'msg_09' } }),
      streamEvent({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
      streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Wiring the job grid ' } }),
      streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'filters to JobFilterState' } }),
      streamEvent({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a"' } }),
      assistant('msg_09', { type: 'text', text: 'Wiring the job grid filters to JobFilterState' }),
    ].flatMap((message) => normaliser.normalise(message));

    expect(items).toEqual([
      { kind: 'text-delta', streamId: 'msg_09', text: 'Wiring the job grid ', parentToolUseId: null },
      { kind: 'text-delta', streamId: 'msg_09', text: 'filters to JobFilterState', parentToolUseId: null },
      { kind: 'text', streamId: 'msg_09', text: 'Wiring the job grid filters to JobFilterState', parentToolUseId: null },
    ]);
  });

  it('turns a result into usage, cost and duration', () => {
    const normaliser = createOutputNormaliser({ cwd: WORKTREE });
    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 72_000,
      duration_api_ms: 60_000,
      num_turns: 14,
      result: 'Done',
      stop_reason: 'end_turn',
      total_cost_usd: 1.25,
      usage: { input_tokens: 1200, output_tokens: 3400, cache_read_input_tokens: 400_000, cache_creation_input_tokens: 8000 },
      modelUsage: {},
      permission_denials: [],
      uuid: nextUuid(),
      ...ids,
    } as unknown as SDKMessage;
    expect(normaliser.normalise(result)).toEqual([
      {
        kind: 'result',
        subtype: 'success',
        isError: false,
        durationMs: 72_000,
        numTurns: 14,
        costUsd: 1.25,
        usage: { inputTokens: 1200, outputTokens: 3400, cacheReadInputTokens: 400_000, cacheCreationInputTokens: 8000 },
        parentToolUseId: null,
      },
    ]);
  });

  it('shows MCP tools as server · tool, hides the agent_lanes stage tools, and summarises errors', () => {
    const normaliser = createOutputNormaliser({ cwd: WORKTREE });
    const items = [
      toolUse('msg_10', 'toolu_ado', 'mcp__azure-devops__wit_get_work_item', { id: 71273 }),
      toolResult('toolu_ado', 'TF401232: Work item 71273 does not exist\nmore detail', undefined, true),
      toolUse('msg_11', 'toolu_stage', 'mcp__agent_lanes__set_stage', { stage: 'implementing', summary: 'Plan approved' }),
      toolResult('toolu_stage', 'Moved to Implementing.'),
    ].flatMap((message) => normaliser.normalise(message));

    expect(items).toEqual([
      { kind: 'tool', rowId: 'toolu_ado', toolUseIds: ['toolu_ado'], tool: 'mcp', label: 'MCP', detail: 'azure-devops · wit_get_work_item', stats: null, input: '{\n  "id": 71273\n}', edit: null, parentToolUseId: null },
      {
        kind: 'tool-result',
        rowId: 'toolu_ado',
        toolUseId: 'toolu_ado',
        isError: true,
        summary: 'TF401232: Work item 71273 does not exist …',
        stats: null,
        output: 'TF401232: Work item 71273 does not exist\nmore detail',
        parentToolUseId: null,
      },
    ]);
  });

  it('covers Write, Grep, Glob, other tools, sub-agent output and paths outside the worktree', () => {
    const normaliser = createOutputNormaliser({ cwd: WORKTREE, platform: 'win32' });
    const outside = join('C:', 'Users', 'kyle', 'notes.md');
    const items = [
      toolUse('msg_12', 'toolu_w', 'Write', { file_path: join(WORKTREE, 'Tests', 'JobFilterTests.cs'), content: 'a\nb\nc\n' }),
      toolUse('msg_13', 'toolu_g', 'Grep', { pattern: 'IWinFormsInvoker', path: join(WORKTREE, 'OnSite') }),
      toolResult('toolu_g', 'Found 3 files', { mode: 'files_with_matches', filenames: ['a', 'b', 'c'], numFiles: 3 }),
      toolUse('msg_14', 'toolu_glob', 'Glob', { pattern: '**/*.razor' }),
      toolUse('msg_15', 'toolu_r', 'Read', { file_path: outside }),
      toolUse('msg_16', 'toolu_skill', 'Skill', { skill: 'code-review' }),
      toolUse('msg_17', 'toolu_sub', 'Read', { file_path: join(WORKTREE, 'a.cs') }, 'toolu_a1'),
    ].flatMap((message) => normaliser.normalise(message));

    const tools = items.filter((item): item is ToolItem => item.kind === 'tool');
    expect(tools.map(({ label, detail, stats, parentToolUseId }) => ({ label, detail, stats, parentToolUseId }))).toEqual([
      { label: 'Write', detail: 'Tests/JobFilterTests.cs', stats: '+3 −0', parentToolUseId: null },
      { label: 'Grep', detail: 'IWinFormsInvoker in OnSite', stats: null, parentToolUseId: null },
      { label: 'Glob', detail: '**/*.razor', stats: null, parentToolUseId: null },
      { label: 'Read', detail: outside, stats: null, parentToolUseId: null },
      { label: 'Skill', detail: 'code-review', stats: null, parentToolUseId: null },
      { label: 'Read', detail: 'a.cs', stats: null, parentToolUseId: 'toolu_a1' },
    ]);
    expect(items.find((item) => item.kind === 'tool-result')).toMatchObject({ rowId: 'toolu_g', stats: '3 files' });
  });
});

describe('output normalisation helpers', () => {
  it('counts build errors and warnings from dotnet, eslint and tsc output', () => {
    expect(buildCounts('Build FAILED.\n    1 Warning(s)\n    3 Error(s)')).toBe('3 errors · 1 warning');
    expect(buildCounts('✖ 5 problems (2 errors, 3 warnings)')).toBe('2 errors · 3 warnings');
    expect(buildCounts('Found 1 error in src/a.ts:3')).toBe('1 error');
    expect(buildCounts('All tests passed')).toBeNull();
  });

  it('counts changed lines like a diff would', () => {
    expect(lineChange('a\nb\nc', 'a\nB\nc\nd')).toEqual({ added: 2, removed: 1 });
    expect(formatLineChange(1234, 5)).toBe('+1,234 −5');
  });

  it('keeps the first line of a result', () => {
    expect(firstLine('\n\n  ok  \n')).toBe('ok');
    expect(firstLine('x'.repeat(600))).toHaveLength(500);
  });
});

describe("the user's own messages read back from a saved session (AL-251)", () => {
  function user(content: unknown, extra: Record<string, unknown> = {}): SDKMessage {
    return { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, uuid: nextUuid(), ...ids, ...extra } as unknown as SDKMessage;
  }

  it("shows a text message as the user's, a /skill line as a skill, and leaves the app's own turns out", () => {
    const normaliser = createOutputNormaliser({ cwd: WORKTREE, hiddenUserTexts: new Set(['Continue where you left off.']) });
    const typed = normaliser.normalise(user('Carry on with the grid', { priority: 'now' }));
    expect(typed).toEqual([{ kind: 'user', messageId: expect.any(String), text: 'Carry on with the grid', priority: 'now', source: 'composer', parentToolUseId: null }]);
    expect(normaliser.normalise(user([{ type: 'text', text: '/code-review' }]))).toMatchObject([{ kind: 'user', text: '/code-review', source: 'skill', priority: null }]);
    expect(normaliser.normalise(user('Continue where you left off.'))).toEqual([]);
    expect(normaliser.normalise(user('build result', { isSynthetic: true }))).toEqual([]);
    expect(normaliser.normalise(user('   '))).toEqual([]);
    // A sub-agent's prompt belongs to its tree, not the Output tab.
    expect(normaliser.normalise(user('Explore the forms', { parent_tool_use_id: 'toolu_spawn' }))).toEqual([]);
  });
});

describe('full inputs and outputs for the expanded row (AL-256)', () => {
  it('carries the whole command and its description, an Edit’s before and after, and a result’s text', () => {
    const normaliser = createOutputNormaliser({ cwd: WORKTREE });
    const [bash] = normaliser.normalise(toolUse('m1', 'tb', 'Bash', { command: 'dotnet test OnSite.Tests --filter JobGrid', description: 'Run the grid tests' }));
    expect(bash).toMatchObject({ kind: 'tool', input: 'dotnet test OnSite.Tests --filter JobGrid\n# Run the grid tests', edit: null });
    const [edit] = normaliser.normalise(toolUse('m2', 'te', 'Edit', { file_path: join(WORKTREE, 'A.cs'), old_string: 'a < b', new_string: 'a <= b' }));
    expect(edit).toMatchObject({ kind: 'tool', input: null, edit: { before: 'a < b', after: 'a <= b' } });
    const [write] = normaliser.normalise(toolUse('m3', 'tw', 'Write', { file_path: join(WORKTREE, 'B.cs'), content: 'x\ny\n' }));
    expect(write).toMatchObject({ kind: 'tool', edit: { before: '', after: 'x\ny\n' } });
    const [grep] = normaliser.normalise(toolUse('m4', 'tg', 'Grep', { pattern: 'Due', path: WORKTREE }));
    expect(grep).toMatchObject({ kind: 'tool', input: expect.stringContaining('"pattern": "Due"') });
    const [result] = normaliser.normalise(toolResult('tb', 'Passed!\nFailed: 0', { stdout: 'Passed!\nFailed: 0', stderr: 'warn: slow' }));
    expect(result).toMatchObject({ kind: 'tool-result', output: 'Passed!\nFailed: 0\nwarn: slow' });
    const [plain] = normaliser.normalise(toolResult('te', 'The file has been updated.'));
    expect(plain).toMatchObject({ kind: 'tool-result', output: 'The file has been updated.' });
  });
});
