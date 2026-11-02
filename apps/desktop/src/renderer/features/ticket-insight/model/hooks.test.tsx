import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AgentSubagents, TicketRecord } from '@agent-lanes/contracts';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { agentOutput } from '@/entities/agent-output';
import { agentTickets } from '@/entities/agent-ticket';
import { fakeOutputEvent, fakeSubagentEvent, fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { agentsCacheSize, resetAgentsCache, useAgents, useTurns } from './hooks';

const lead = fakeTicketRecord({ id: '71273' });
const reviewer: TicketRecord = fakeTicketRecord({ id: '71273-reviewer', createdAt: 5_000, companion: { of: '71273', role: 'reviewer', name: 'Eyes' } });

const tree: AgentSubagents = {
  ticketId: '71273',
  leadTokens: 120_000,
  nodes: [fakeSubagentEvent('71273', 3_000).node],
  counts: { queued: 0, running: 1, done: 0, failed: 0 },
};

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const edit = (ticketId: string, at: number, detail: string, parent: string | null = null) =>
  fakeOutputEvent(ticketId, at, { item: { kind: 'tool', rowId: `r${at}`, toolUseIds: [`r${at}`], tool: 'edit', label: 'Edit', detail, stats: null, parentToolUseId: parent } });

describe('ticket insight hooks (AL-278)', () => {
  beforeEach(() => {
    installFakeBridge({
      'agent:getSubagents': { ok: true, data: tree },
      'agent:getTranscript': { ok: true, data: { ticketId: '71273', events: [], lastSeq: 0 } },
    });
    resetAgentsCache();
    agentOutput.forget('71273');
    agentOutput.forget('71273-reviewer');
    agentTickets.upsert(lead);
    agentTickets.upsert(reviewer);
  });

  it('joins the lead, its sub-agents and its second agents, with colours and what each is doing', async () => {
    agentOutput.watch('71273');
    agentOutput.watch('71273-reviewer');
    agentOutput.receive([edit('71273', 100, 'src/Grid.razor'), edit('71273', 110, 'src/Grid.razor.cs', 'toolu_agent_1'), edit('71273-reviewer', 120, 'src/Notes.md')]);
    agentTickets.setSession('71273', 'running');

    const { result } = renderHook(() => useAgents('71273', [reviewer]), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.map((agent) => agent.id)).toEqual(['71273', 'toolu_agent_1', '71273-reviewer']));
    expect(result.current.map((agent) => agent.color)).toEqual(['#5B4BC4', '#0369A1', '#0D9488']);
    expect(result.current[0]).toMatchObject({ role: 'lead', tokens: 120_000 });
    expect(result.current[1]).toMatchObject({ name: 'razor-writer', status: 'running', activeFile: 'src/Grid.razor.cs', activeKind: 'edit' });
    expect(result.current[2]).toMatchObject({ role: 'reviewer', branch: null });
  });

  it('derives the ticket’s turns from its output and stage history', async () => {
    agentOutput.watch('71273');
    agentOutput.receive([
      fakeOutputEvent('71273', 2_100, { item: { kind: 'user', messageId: null, text: 'go', priority: null, source: 'composer', parentToolUseId: null } }),
      edit('71273', 2_200, 'a.cs'),
    ]);
    const { result } = renderHook(() => useTurns('71273', lead.stageHistory), { wrapper: wrapper() });
    await act(async () => undefined);
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({ index: 1, endedAt: null, stage: 'implementing', toolCounts: { Edit: 1 } });
  });

  describe('while text streams', () => {
    const delta = (ticketId: string, at: number, text: string, streamId = 'msg_live') =>
      fakeOutputEvent(ticketId, at, { item: { kind: 'text-delta', streamId, text, parentToolUseId: null } });
    const thinking = (ticketId: string, at: number, text: string) =>
      fakeOutputEvent(ticketId, at, { item: { kind: 'thinking-delta', streamId: 'think_1', text, parentToolUseId: null } });
    const user = fakeOutputEvent('71273', 2_100, { item: { kind: 'user', messageId: null, text: 'go', priority: null, source: 'composer', parentToolUseId: null } });

    it('does not re-render, or re-derive turns and agents, for text and thinking deltas, only for a tool call', async () => {
      agentOutput.watch('71273');
      agentOutput.watch('71273-reviewer');
      // Each stream's first delta is structural (it opens a row), so the streams are already open.
      agentOutput.receive([user, edit('71273', 2_200, 'a.cs'), delta('71273', 2_300, 'Wir'), thinking('71273', 2_310, 'h'), edit('71273-reviewer', 2_250, 'n.md'), delta('71273-reviewer', 2_260, 'Look')]);
      agentTickets.setSession('71273', 'running');

      let renders = 0;
      const { result } = renderHook(
        () => {
          renders += 1;
          return { turns: useTurns('71273', lead.stageHistory), agents: useAgents('71273', [reviewer]) };
        },
        { wrapper: wrapper() },
      );
      await waitFor(() => expect(result.current.agents).toHaveLength(3));
      await act(async () => undefined);
      const settled = { renders, ...result.current };

      act(() => agentOutput.receive([delta('71273', 2_400, 'ing '), thinking('71273', 2_410, 'hm')]));
      act(() => agentOutput.receive([delta('71273', 2_500, 'the grid'), delta('71273-reviewer', 2_510, 'Looks fine'), thinking('71273', 2_520, 'hmm')]));
      act(() => agentOutput.receive([delta('71273', 2_600, '.')]));

      expect(renders).toBe(settled.renders);
      expect(result.current.turns).toBe(settled.turns);
      expect(result.current.agents).toBe(settled.agents);

      act(() => agentOutput.receive([edit('71273', 2_700, 'b.cs')]));
      expect(result.current.turns).not.toBe(settled.turns);
      expect(result.current.turns[0]).toMatchObject({ toolCounts: { Edit: 2 } });
      expect(result.current.agents[0]).toMatchObject({ id: '71273', activeFile: 'b.cs' });
    });

    it('gives every caller asking for the same agents the one array, and keeps it while nothing they show changed', async () => {
      agentOutput.watch('71273');
      agentOutput.receive([edit('71273', 2_200, 'a.cs')]);
      agentTickets.setSession('71273', 'running');

      const { result } = renderHook(() => ({ first: useAgents('71273', [reviewer]), second: useAgents('71273', [reviewer]) }), { wrapper: wrapper() });
      await waitFor(() => expect(result.current.first).toHaveLength(3));
      expect(result.current.second).toBe(result.current.first);

      // A tool the agents' activity ignores re-derives them to the same views.
      const before = result.current.first;
      act(() =>
        agentOutput.receive([
          fakeOutputEvent('71273', 2_300, { item: { kind: 'tool', rowId: 'todo', toolUseIds: ['todo'], tool: 'other', label: 'TodoWrite', detail: '', stats: null, parentToolUseId: null } }),
        ]),
      );
      expect(result.current.first).toBe(before);
    });

    it('forgets a ticket’s shared agents when its output is forgotten', () => {
      agentOutput.watch('71273');
      const { result, unmount } = renderHook(() => useAgents('71273'), { wrapper: wrapper() });
      expect(result.current).toHaveLength(1);
      expect(agentsCacheSize()).toBe(1);
      unmount();
      act(() => agentOutput.forget('71273'));
      expect(agentsCacheSize()).toBe(0);
    });

    it('asks for no turns and watches nothing when there is no ticket', () => {
      const watching = agentOutput.getState().byTicket.size;
      const { result } = renderHook(() => useTurns(null, lead.stageHistory), { wrapper: wrapper() });
      expect(result.current).toEqual([]);
      expect(agentOutput.getState().byTicket.size).toBe(watching);
    });
  });

  describe('the live turn’s clock', () => {
    afterEach(() => vi.useRealTimers());

    it('runs the live turn’s duration from the clock while it is live, and stops once the turn has ended', async () => {
      vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
      vi.setSystemTime(1_000_000);
      const turnStart = fakeOutputEvent('71273', 995_000, { item: { kind: 'user', messageId: null, text: 'go', priority: null, source: 'composer', parentToolUseId: null } });
      agentOutput.watch('71273');
      agentOutput.receive([turnStart, edit('71273', 996_000, 'a.cs'), fakeOutputEvent('71273', 996_500, { item: { kind: 'text-delta', streamId: 'live', text: 'Long stream', parentToolUseId: null } })]);

      let renders = 0;
      const { result } = renderHook(
        () => {
          renders += 1;
          return useTurns('71273', lead.stageHistory);
        },
        { wrapper: wrapper() },
      );
      await act(async () => undefined);
      // The newest event is 1.5 s after the turn began, but the clock says 5 s.
      expect(result.current[0]).toMatchObject({ endedAt: null, durationMs: 5_000 });

      act(() => {
        vi.advanceTimersByTime(3_000);
      });
      expect(result.current[0]!.durationMs).toBe(8_000);

      act(() =>
        agentOutput.receive([
          fakeOutputEvent('71273', 1_003_500, { item: { kind: 'result', subtype: 'success', isError: false, durationMs: 7_000, numTurns: 1, costUsd: 0.1, usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 }, parentToolUseId: null } }),
        ]),
      );
      expect(result.current[0]).toMatchObject({ endedAt: 1_003_500, durationMs: 7_000 });
      const settled = renders;
      act(() => {
        vi.advanceTimersByTime(5_000);
      });
      expect(renders).toBe(settled);
    });
  });
});
