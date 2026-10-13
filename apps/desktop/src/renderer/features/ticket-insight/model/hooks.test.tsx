import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AgentSubagents, TicketRecord } from '@agent-lanes/contracts';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { agentOutput } from '@/entities/agent-output';
import { agentTickets } from '@/entities/agent-ticket';
import { fakeOutputEvent, fakeSubagentEvent, fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { useAgents, useTurns } from './hooks';

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
});
