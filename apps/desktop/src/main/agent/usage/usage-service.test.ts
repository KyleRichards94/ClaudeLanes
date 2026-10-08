import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { formatTokenCount, ok, err, type AgentUsage } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import type { SessionMessageListener } from '../session-manager';
import { recordingEmit } from '../testing/sessions';
import { createUsageService, modelUsageTotals, usageTokens } from './usage-service';

function fakeSessions(context: { totalTokens: number; maxTokens: number; percentage: number } | Error = { totalTokens: 50_000, maxTokens: 200_000, percentage: 25 }) {
  const listeners = new Set<SessionMessageListener>();
  return {
    subscribe(listener: SessionMessageListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    contextUsage: async () => (context instanceof Error ? err('INTERNAL', context.message) : ok(context)),
    deliver(ticketId: string, message: SDKMessage) {
      for (const listener of listeners) listener({ ticketId, cwd: 'C:/wt', resumed: false, message });
    },
    listeners,
  };
}

const usage = (input: number, output: number, cacheRead = 0, cacheCreation = 0) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheCreation,
});

const modelUsage = (input: number, output: number, cacheRead = 0, cacheCreation = 0, costUSD = 0) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadInputTokens: cacheRead,
  cacheCreationInputTokens: cacheCreation,
  webSearchRequests: 0,
  costUSD,
  contextWindow: 200_000,
  maxOutputTokens: 32_000,
});

function result(fields: { usage?: object; modelUsage?: object; total_cost_usd?: number }): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'done',
    num_turns: 1,
    duration_ms: 10,
    duration_api_ms: 10,
    stop_reason: 'end_turn',
    total_cost_usd: fields.total_cost_usd ?? 0,
    usage: fields.usage ?? usage(0, 0),
    modelUsage: fields.modelUsage ?? {},
    permission_denials: [],
    uuid: '00000000-0000-4000-8000-000000000001',
    session_id: 's-1',
  } as unknown as SDKMessage;
}

function subagentMessage(parent: string, id: string, tokens: ReturnType<typeof usage>): SDKMessage {
  return {
    type: 'assistant',
    parent_tool_use_id: parent,
    message: { id, role: 'assistant', content: [{ type: 'text', text: '…' }], usage: tokens },
    uuid: `00000000-0000-4000-8000-${id.padStart(12, '0')}`,
    session_id: 's-1',
  } as unknown as SDKMessage;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('usage service (AL-113)', () => {
  it('adds input, output, cache reads and cache writes', () => {
    expect(usageTokens(usage(10, 20, 300, 4))).toBe(334);
    expect(usageTokens(undefined)).toBe(0);
    expect(modelUsageTotals({})).toBeNull();
  });

  it("session totals match the SDK's result usage within rounding", async () => {
    const sessions = fakeSessions();
    const { emit, of } = recordingEmit();
    const service = createUsageService({ sessions, emit, now: () => 1_000 });

    // Two turns: the latest result carries the running totals for every model (opus lead, haiku sub-agent).
    sessions.deliver('71273', result({ usage: usage(1_000, 2_000, 90_000, 7_000), modelUsage: { 'claude-opus-5-5': modelUsage(1_000, 2_000, 90_000, 7_000) }, total_cost_usd: 0.42 }));
    const second = {
      'claude-opus-5-5': modelUsage(3_100, 6_400, 288_000, 12_500, 1.1),
      'claude-haiku-4-5': modelUsage(20_000, 4_000, 77_000, 0, 0.13),
    };
    sessions.deliver('71273', result({ usage: usage(2_100, 4_400, 198_000, 5_500), modelUsage: second, total_cost_usd: 1.234567 }));
    await flush();

    const expected = Object.values(second).reduce((sum, m) => sum + m.inputTokens + m.outputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens, 0);
    const got = service.get('71273');
    expect(got.totalTokens).toBe(expected);
    expect(got.inputTokens).toBe(23_100);
    expect(got.outputTokens).toBe(10_400);
    expect(got.cacheReadInputTokens).toBe(365_000);
    expect(got.cacheCreationInputTokens).toBe(12_500);
    expect(got.costUsd).toBeCloseTo(1.234567, 6);
    expect(got.turns).toBe(2);
    // The pill rounds to the nearest thousand: 411,000 → "411k tokens".
    expect(formatTokenCount(got.totalTokens)).toBe(`${Math.round(expected / 1000)}k tokens`);
    // Lead agent: the main loop's per-turn usage, summed.
    expect(got.leadTokens).toBe(100_000 + 210_000);

    const events = of('agent:usage', '71273');
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect((events.at(-1)?.['usage'] as AgentUsage).context).toEqual({ usedTokens: 50_000, maxTokens: 200_000, percentage: 25 });
  });

  it('counts each sub-agent once per API message', () => {
    const sessions = fakeSessions();
    const service = createUsageService({ sessions, emit: recordingEmit().emit });
    sessions.deliver('71273', subagentMessage('toolu_explore', '1', usage(100, 50)));
    // The same message streamed in another part repeats its usage.
    sessions.deliver('71273', subagentMessage('toolu_explore', '1', usage(100, 50)));
    sessions.deliver('71273', subagentMessage('toolu_explore', '2', usage(200, 10)));
    sessions.deliver('71273', subagentMessage('toolu_writer', '3', usage(5, 5)));
    sessions.deliver('71273', result({}));
    expect(service.get('71273').subagents).toEqual([
      { toolUseId: 'toolu_explore', tokens: 360 },
      { toolUseId: 'toolu_writer', tokens: 10 },
    ]);
  });

  it('keeps the totals when a result has no per-model usage', () => {
    const sessions = fakeSessions(new Error('not running'));
    const service = createUsageService({ sessions, emit: recordingEmit().emit });
    sessions.deliver('71273', result({ modelUsage: { m: modelUsage(10, 10) }, total_cost_usd: 0.5 }));
    sessions.deliver('71273', result({}));
    expect(service.get('71273')).toMatchObject({ totalTokens: 20, costUsd: 0.5, turns: 2, context: null });
  });

  it('keeps tickets apart and stops listening on dispose', () => {
    const sessions = fakeSessions();
    const service = createUsageService({ sessions, emit: recordingEmit().emit });
    sessions.deliver('a', result({ modelUsage: { m: modelUsage(1, 1) } }));
    expect(service.get('b').totalTokens).toBe(0);
    expect(service.get('a').totalTokens).toBe(2);
    service.dispose();
    expect(sessions.listeners.size).toBe(0);
  });
});
