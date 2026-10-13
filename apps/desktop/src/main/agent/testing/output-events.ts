import type { AgentOutputEvent, AgentOutputItem } from '@agent-lanes/contracts';

/** Builders for output events in the attribution and review tests. Never imported by production code. */

type ToolItem = Extract<AgentOutputItem, { kind: 'tool' }>;

/** Events numbered and timed in call order, for one ticket's transcript. */
export function eventLog(ticketId = '71273', startAt = 1_000) {
  let seq = 0;
  let at = startAt;
  const events: AgentOutputEvent[] = [];
  const push = (item: AgentOutputItem, time?: number) => {
    seq += 1;
    at += 1;
    events.push({ ticketId, at: time ?? at, seq, item });
  };
  return {
    events,
    /** An Edit row, with the text it wrote. */
    edit: (id: string, path: string, after: string, parent: string | null = null) => push(toolRow(id, 'edit', path, { edit: { before: 'old', after }, parentToolUseId: parent })),
    /** A Write row, with the whole file. */
    write: (id: string, path: string, content: string, parent: string | null = null) =>
      push(toolRow(id, 'write', path, { stats: `+${content.split('\n').length} −0`, edit: { before: '', after: content }, parentToolUseId: parent })),
    /** A MultiEdit row: no before and after, the input as JSON. */
    multiEdit: (id: string, path: string, newStrings: string[], parent: string | null = null) =>
      push(toolRow(id, 'edit', path, { input: JSON.stringify({ file_path: path, edits: newStrings.map((text) => ({ old_string: 'x', new_string: text })) }), parentToolUseId: parent })),
    read: (id: string, path: string, parent: string | null = null) => push(toolRow(id, 'read', path, { parentToolUseId: parent })),
    bash: (id: string, command: string, parent: string | null = null) => push(toolRow(id, 'bash', command, { parentToolUseId: parent })),
    result: (id: string, isError = false, parent: string | null = null) => push({ kind: 'tool-result', rowId: id, toolUseId: id, isError, summary: '', stats: null, parentToolUseId: parent }),
    text: (text: string, parent: string | null = null) => push({ kind: 'text', streamId: `m${seq + 1}`, text, parentToolUseId: parent }),
    turnEnded: () => push({ kind: 'result', subtype: 'success', isError: false, durationMs: 1, numTurns: 1, costUsd: 0, usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, parentToolUseId: null }),
  };
}

function toolRow(id: string, tool: ToolItem['tool'], detail: string, rest: Partial<ToolItem> & { parentToolUseId: string | null }): ToolItem {
  return { kind: 'tool', rowId: id, toolUseIds: [id], tool, label: tool, detail, stats: null, input: null, edit: null, ...rest };
}

/** `n` lines of text. */
export function lines(n: number, prefix = 'line'): string {
  return Array.from({ length: n }, (_, index) => `${prefix} ${index + 1}`).join('\n');
}
