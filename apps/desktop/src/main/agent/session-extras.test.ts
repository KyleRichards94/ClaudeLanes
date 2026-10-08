import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import { combineSessionExtras } from './session-extras';
import { sessionOptions } from './session-manager';
import { memoryTickets } from './testing/sessions';

const hook: HookCallback = async () => ({});
const other: HookCallback = async () => ({});

describe('session extras (AL-100 D539, AL-084)', () => {
  it('combines the stage server and the sub-agent worktree hooks into one session', async () => {
    const record = await (await memoryTickets({ id: '71273' })).get('71273');
    if (!record) throw new Error('no record');
    const merged = await combineSessionExtras([
      () => ({ allowedTools: ['mcp__agent_lanes__set_stage'], systemPromptAppend: 'Stage protocol', firstTurnAppendix: ['Report stages'], hooks: { SubagentStart: [{ hooks: [other] }] } }),
      () => ({ hooks: { WorktreeCreate: [{ hooks: [hook] }], SubagentStart: [{ hooks: [hook] }] } }),
      () => ({ systemPromptAppend: 'More' }),
    ])(record);
    expect(merged.allowedTools).toEqual(['mcp__agent_lanes__set_stage']);
    expect(merged.systemPromptAppend).toBe('Stage protocol\n\nMore');
    expect(merged.firstTurnAppendix).toEqual(['Report stages']);
    expect(merged.hooks?.WorktreeCreate).toEqual([{ hooks: [hook] }]);
    expect(merged.hooks?.SubagentStart).toEqual([{ hooks: [other] }, { hooks: [hook] }]);
    expect((await combineSessionExtras([() => ({})])(record)).hooks).toBeUndefined();
  });

  it('passes the hooks to the SDK options, and none when there are none', async () => {
    const record = await (await memoryTickets({ id: '71273' })).get('71273');
    if (!record) throw new Error('no record');
    const hooks = { WorktreeCreate: [{ hooks: [hook] }] };
    expect(sessionOptions(record, new AbortController(), { hooks }).hooks).toBe(hooks);
    expect(sessionOptions(record, new AbortController(), {}).hooks).toBeUndefined();
  });
});
