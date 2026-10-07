import { isAbsolute, relative } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { OUTPUT_LINE_LIMIT, OUTPUT_TEXT_LIMIT, type AgentOutputItem, type OutputToolKind } from '@agent-lanes/contracts';

/**
 * Turns the Agent SDK's messages into the output items the drill-in's Output tab draws (AL-102,
 * design §6 Live events, artboard 3): streamed and finished assistant text, one row per tool call
 * with a one-line mono detail and stats, a summary of each tool result, and each turn's result.
 *
 * One normaliser per ticket session: it remembers the tool calls it has seen so their results can be
 * matched to their rows, and the API message each streamed text delta belongs to.
 */
export interface OutputNormaliser {
  normalise(message: SDKMessage): AgentOutputItem[];
}

export interface OutputNormaliserOptions {
  /** The ticket worktree; file paths inside it are shown relative to it. */
  cwd: string;
  platform?: NodeJS.Platform;
}

/** The in-process stage server's tools (AL-103) are app plumbing: the stage line comes from the app, not a tool row. */
const HIDDEN_MCP_SERVERS = new Set(['agent_lanes']);

const MINUS = '−';

interface ToolUse {
  rowId: string;
  tool: OutputToolKind;
  name: string;
  parentToolUseId: string | null;
}

interface SpawnRow {
  rowId: string;
  toolUseIds: string[];
  names: string[];
}

type Block = { type: string; [key: string]: unknown };

export function formatCount(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;
}

/** `+214 −0`, as on artboard 3. */
export function formatLineChange(added: number, removed: number): string {
  return `+${added.toLocaleString('en-US')} ${MINUS}${removed.toLocaleString('en-US')}`;
}

function clip(text: string, limit = OUTPUT_LINE_LIMIT): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/** The first non-empty line, clipped; a second line is marked with an ellipsis. */
export function firstLine(text: string): string {
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  const first = lines[0]?.trim() ?? '';
  return clip(lines.length > 1 ? `${first} …` : first);
}

function lineCount(text: string): number {
  if (text === '') return 0;
  const lines = text.split(/\r?\n/);
  return lines.at(-1) === '' ? lines.length - 1 : lines.length;
}

/** Lines only in `after` and lines only in `before`, counted as multisets (close to what a diff shows). */
export function lineChange(before: string, after: string): { added: number; removed: number } {
  const remaining = new Map<string, number>();
  const beforeLines = before === '' ? [] : before.split(/\r?\n/);
  const afterLines = after === '' ? [] : after.split(/\r?\n/);
  for (const line of beforeLines) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  let added = 0;
  for (const line of afterLines) {
    const left = remaining.get(line) ?? 0;
    if (left > 0) remaining.set(line, left - 1);
    else added += 1;
  }
  let removed = 0;
  for (const left of remaining.values()) removed += left;
  return { added, removed };
}

/** Counts `+` and `-` lines in a structured patch (Edit and Write results). */
function patchChange(patch: unknown): { added: number; removed: number } | null {
  if (!Array.isArray(patch) || patch.length === 0) return null;
  let added = 0;
  let removed = 0;
  for (const hunk of patch) {
    const lines = (hunk as { lines?: unknown }).lines;
    if (!Array.isArray(lines)) return null;
    for (const line of lines) {
      if (typeof line !== 'string') continue;
      if (line.startsWith('+')) added += 1;
      else if (line.startsWith('-')) removed += 1;
    }
  }
  return { added, removed };
}

/**
 * Errors and warnings a build, test or lint run reported: MSBuild/dotnet (`2 Warning(s)`,
 * `0 Error(s)`), ESLint (`✖ 3 problems (1 error, 2 warnings)`) and tsc (`Found 4 errors`).
 */
export function buildCounts(output: string): string | null {
  const msbuildErrors = /(\d+)\s+Error\(s\)/i.exec(output);
  const msbuildWarnings = /(\d+)\s+Warning\(s\)/i.exec(output);
  if (msbuildErrors || msbuildWarnings) {
    return countsLine(msbuildErrors ? Number(msbuildErrors[1]) : null, msbuildWarnings ? Number(msbuildWarnings[1]) : null);
  }
  const eslint = /✖\s+\d+\s+problems?\s+\((\d+)\s+errors?,\s+(\d+)\s+warnings?\)/.exec(output);
  if (eslint) return countsLine(Number(eslint[1]), Number(eslint[2]));
  const tsc = /Found\s+(\d+)\s+errors?\b/.exec(output);
  if (tsc) return countsLine(Number(tsc[1]), null);
  return null;
}

function countsLine(errors: number | null, warnings: number | null): string {
  return [errors === null ? null : formatCount(errors, 'error'), warnings === null ? null : formatCount(warnings, 'warning')].filter(Boolean).join(' · ');
}

function stringField(input: unknown, key: string): string | undefined {
  const value = (input as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === 'string' ? value : undefined;
}

/** Text of a tool result's content: a string, or its text blocks joined. */
function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block: Block) => (block?.type === 'text' && typeof block['text'] === 'string' ? block['text'] : ''))
    .filter(Boolean)
    .join('\n');
}

export function createOutputNormaliser(options: OutputNormaliserOptions): OutputNormaliser {
  const platform = options.platform ?? process.platform;
  const toolUses = new Map<string, ToolUse | 'hidden'>();
  const spawnRows = new Map<string, SpawnRow>();
  /** The API message each agent's streamed text belongs to, by parent tool use ('' for the lead agent). */
  const streaming = new Map<string, string>();

  /** A worktree-relative path with forward slashes; paths outside the worktree stay as they are. */
  function displayPath(path: string | undefined): string {
    if (!path) return '';
    if (!isAbsolute(path)) return path.replaceAll('\\', '/');
    const fold = (value: string) => (platform === 'win32' ? value.toLowerCase() : value);
    const inside = relative(fold(options.cwd), fold(path));
    if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return path;
    // Keep the path's own casing: take the same number of trailing characters from the original.
    return path.slice(path.length - inside.length).replaceAll('\\', '/');
  }

  function spawnName(input: unknown): string {
    return stringField(input, 'name') ?? stringField(input, 'subagent_type') ?? stringField(input, 'description') ?? 'agent';
  }

  function toolRow(block: Block, messageId: string, parentToolUseId: string | null): AgentOutputItem | null {
    const id = String(block['id']);
    const name = String(block['name']);
    const input = block['input'];

    if (name.startsWith('mcp__')) {
      const [, server = '', ...rest] = name.split('__');
      if (HIDDEN_MCP_SERVERS.has(server)) {
        toolUses.set(id, 'hidden');
        return null;
      }
      return remember(id, { kind: 'tool', rowId: id, toolUseIds: [id], tool: 'mcp', label: 'MCP', detail: clip(`${server} · ${rest.join('__')}`), stats: null, parentToolUseId }, name);
    }

    switch (name) {
      case 'Read':
        return remember(id, { kind: 'tool', rowId: id, toolUseIds: [id], tool: 'read', label: 'Read', detail: clip(displayPath(stringField(input, 'file_path'))), stats: null, parentToolUseId }, name);
      case 'Edit': {
        const { added, removed } = lineChange(stringField(input, 'old_string') ?? '', stringField(input, 'new_string') ?? '');
        return remember(id, { kind: 'tool', rowId: id, toolUseIds: [id], tool: 'edit', label: 'Edit', detail: clip(displayPath(stringField(input, 'file_path'))), stats: formatLineChange(added, removed), parentToolUseId }, name);
      }
      case 'MultiEdit':
      case 'NotebookEdit':
        return remember(
          id,
          { kind: 'tool', rowId: id, toolUseIds: [id], tool: 'edit', label: 'Edit', detail: clip(displayPath(stringField(input, 'file_path') ?? stringField(input, 'notebook_path'))), stats: null, parentToolUseId },
          name,
        );
      case 'Write':
        return remember(
          id,
          { kind: 'tool', rowId: id, toolUseIds: [id], tool: 'write', label: 'Write', detail: clip(displayPath(stringField(input, 'file_path'))), stats: formatLineChange(lineCount(stringField(input, 'content') ?? ''), 0), parentToolUseId },
          name,
        );
      case 'Bash':
        return remember(id, { kind: 'tool', rowId: id, toolUseIds: [id], tool: 'bash', label: 'Bash', detail: firstLine(stringField(input, 'command') ?? ''), stats: null, parentToolUseId }, name);
      case 'Grep':
      case 'Glob': {
        const where = stringField(input, 'path');
        const detail = `${stringField(input, 'pattern') ?? ''}${where ? ` in ${displayPath(where)}` : ''}`;
        return remember(id, { kind: 'tool', rowId: id, toolUseIds: [id], tool: name === 'Grep' ? 'grep' : 'glob', label: name, detail: clip(detail), stats: null, parentToolUseId }, name);
      }
      case 'Agent':
      case 'Task': {
        // Sub-agents started in one assistant message share one Spawn row ("explore · razor-writer · test-writer").
        const key = `${parentToolUseId ?? ''}:${messageId}`;
        const row = spawnRows.get(key) ?? { rowId: `spawn:${id}`, toolUseIds: [], names: [] };
        row.toolUseIds.push(id);
        row.names.push(spawnName(input));
        spawnRows.set(key, row);
        return remember(
          id,
          {
            kind: 'tool',
            rowId: row.rowId,
            toolUseIds: [...row.toolUseIds],
            tool: 'spawn',
            label: 'Spawn',
            detail: clip(row.names.join(' · ')),
            stats: formatCount(row.toolUseIds.length, 'sub-agent'),
            parentToolUseId,
          },
          name,
        );
      }
      default: {
        const detail = ['skill', 'url', 'query', 'command', 'description', 'prompt', 'file_path'].map((key) => stringField(input, key)).find(Boolean) ?? '';
        return remember(id, { kind: 'tool', rowId: id, toolUseIds: [id], tool: 'other', label: clip(name, 100), detail: firstLine(detail), stats: null, parentToolUseId }, name);
      }
    }
  }

  function remember(id: string, item: Extract<AgentOutputItem, { kind: 'tool' }>, name: string): AgentOutputItem {
    toolUses.set(id, { rowId: item.rowId, tool: item.tool, name, parentToolUseId: item.parentToolUseId });
    return item;
  }

  /** Stats a tool's result adds to its row; null keeps the row's own. */
  function resultStats(use: ToolUse, text: string, structured: unknown): string | null {
    const data = structured as Record<string, unknown> | undefined;
    switch (use.tool) {
      case 'read': {
        const file = data?.['file'] as { totalLines?: unknown; numLines?: unknown } | undefined;
        const total = typeof file?.totalLines === 'number' ? file.totalLines : typeof file?.numLines === 'number' ? file.numLines : null;
        if (total !== null) return formatCount(total, 'line');
        const numbered = text.split(/\r?\n/).filter((line) => /^\s*\d+[→\t]/.test(line)).length;
        return numbered > 0 ? formatCount(numbered, 'line') : null;
      }
      case 'edit':
      case 'write': {
        const change = patchChange(data?.['structuredPatch']);
        return change ? formatLineChange(change.added, change.removed) : null;
      }
      case 'bash': {
        const output = data ? [data['stdout'], data['stderr']].filter((part) => typeof part === 'string').join('\n') : text;
        return buildCounts(output || text);
      }
      case 'grep':
      case 'glob': {
        if (typeof data?.['numFiles'] === 'number') return formatCount(data['numFiles'], 'file');
        if (Array.isArray(data?.['filenames'])) return formatCount(data['filenames'].length, 'file');
        return null;
      }
      default:
        return null;
    }
  }

  function assistantItems(message: Extract<SDKMessage, { type: 'assistant' }>): AgentOutputItem[] {
    const parentToolUseId = message.parent_tool_use_id;
    const messageId = message.message.id ?? message.uuid;
    const items: AgentOutputItem[] = [];
    for (const block of (message.message.content ?? []) as unknown as Block[]) {
      if (block.type === 'text' && typeof block['text'] === 'string' && block['text'].trim() !== '') {
        items.push({ kind: 'text', streamId: messageId, text: clip(block['text'], OUTPUT_TEXT_LIMIT), parentToolUseId });
      } else if (block.type === 'tool_use') {
        const row = toolRow(block, messageId, parentToolUseId);
        if (row) items.push(row);
      }
    }
    return items;
  }

  function toolResultItems(message: Extract<SDKMessage, { type: 'user' }>): AgentOutputItem[] {
    const content = message.message.content;
    if (!Array.isArray(content)) return [];
    const results = (content as unknown as Block[]).filter((block) => block.type === 'tool_result');
    const items: AgentOutputItem[] = [];
    for (const block of results) {
      const toolUseId = String(block['tool_use_id']);
      const use = toolUses.get(toolUseId);
      if (!use || use === 'hidden') continue;
      const text = resultText(block['content']);
      // `tool_use_result` is the structured output of the message's tool call, when it holds one result.
      const structured = results.length === 1 ? message.tool_use_result : undefined;
      items.push({
        kind: 'tool-result',
        rowId: use.rowId,
        toolUseId,
        isError: block['is_error'] === true,
        summary: firstLine(text),
        stats: resultStats(use, text, structured),
        parentToolUseId: use.parentToolUseId,
      });
    }
    return items;
  }

  return {
    normalise(message) {
      switch (message.type) {
        case 'stream_event': {
          const key = message.parent_tool_use_id ?? '';
          const event = message.event;
          if (event.type === 'message_start') {
            streaming.set(key, event.message.id);
            return [];
          }
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta' && event.delta.text) {
            return [{ kind: 'text-delta', streamId: streaming.get(key) ?? message.uuid, text: clip(event.delta.text, OUTPUT_TEXT_LIMIT), parentToolUseId: message.parent_tool_use_id }];
          }
          return [];
        }
        case 'assistant':
          return assistantItems(message);
        case 'user':
          return toolResultItems(message);
        case 'result':
          return [
            {
              kind: 'result',
              subtype: message.subtype,
              isError: message.is_error,
              durationMs: Math.max(0, message.duration_ms ?? 0),
              numTurns: Math.max(0, message.num_turns ?? 0),
              costUsd: Math.max(0, message.total_cost_usd ?? 0),
              usage: {
                inputTokens: message.usage?.input_tokens ?? 0,
                outputTokens: message.usage?.output_tokens ?? 0,
                cacheReadInputTokens: message.usage?.cache_read_input_tokens ?? 0,
                cacheCreationInputTokens: message.usage?.cache_creation_input_tokens ?? 0,
              },
              parentToolUseId: null,
            },
          ];
        default:
          return [];
      }
    },
  };
}
