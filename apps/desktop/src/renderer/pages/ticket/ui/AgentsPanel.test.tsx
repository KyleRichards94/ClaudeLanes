import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { emptyAgentUsage, type AgentSubagents, type SubagentNode } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { agentTickets, ticketFromRecord } from '@/entities/agent-ticket';
import { subAgentEventHandlers } from '@/entities/sub-agent';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { AgentsPanel } from './TicketPanels';

function node(fields: Partial<SubagentNode> & { id: string }): SubagentNode {
  return {
    taskId: null,
    parentId: null,
    name: fields.id,
    agentType: null,
    description: '',
    model: null,
    effort: null,
    status: 'running',
    activity: null,
    tokens: null,
    branch: null,
    readOnly: false,
    startedAt: 1,
    endedAt: null,
    ...fields,
  };
}

/** Artboard 3's Sub-agents column: explore done, two writers running, the reviewer queued. */
const tree: AgentSubagents = {
  ticketId: '71273',
  leadTokens: 212_000,
  counts: { running: 2, done: 1, queued: 1, failed: 0 },
  nodes: [
    node({ id: 'explore', agentType: 'explore', model: 'haiku', effort: 'low', status: 'done', readOnly: true, activity: 'Mapped 4 child modals + 31 event handlers', startedAt: 1 }),
    node({ id: 'razor-writer', model: 'sonnet', effort: 'high', branch: 'sub/71273-grid', activity: 'Building JobGrid.razor column templates', startedAt: 2 }),
    node({ id: 'test-writer', model: 'sonnet', effort: 'medium', branch: 'sub/71273-tests', activity: 'bUnit tests for JobFilter date range', startedAt: 3 }),
    node({ id: 'reviewer', agentType: 'reviewer', model: 'opus', effort: 'high', status: 'queued', readOnly: true, description: 'Review the cutover', startedAt: 4 }),
  ],
};

function renderPanel(stage: 'implementing' | 'code-review' = 'implementing') {
  installFakeBridge({ 'agent:getSubagents': { ok: true, data: tree } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const record = fakeTicketRecord({ id: '71273', stage, model: 'opus', effort: 'xhigh' });
  agentTickets.load([record]);
  const ticket = ticketFromRecord(record);
  render(
    <QueryClientProvider client={client}>
      <AgentsPanel ticket={ticket} />
    </QueryClientProvider>,
  );
  return { client };
}

describe('AgentsPanel (AL-177, AL-279)', () => {
  it('shows the lead agent, the counts and each sub-agent as on artboard 3', async () => {
    renderPanel();
    expect(await screen.findByText('2 running · 1 done · 1 queued')).toBeTruthy();
    const lead = screen.getByTestId('lead-agent');
    expect(within(lead).getByText('Opus · XHigh · orchestrating')).toBeTruthy();
    expect(within(lead).getByText('212k tokens')).toBeTruthy();

    const explore = screen.getByTestId('sub-agent-explore');
    expect(within(explore).getByText('Done')).toBeTruthy();
    expect(within(explore).getByText('Haiku · Low')).toBeTruthy();
    expect(within(explore).getByText('read-only')).toBeTruthy();

    const writer = screen.getByTestId('sub-agent-razor-writer');
    expect(within(writer).getByText('Running')).toBeTruthy();
    expect(within(writer).getByText('Building JobGrid.razor column templates')).toBeTruthy();
    expect(within(writer).getByText('Sonnet · High')).toBeTruthy();
    expect(within(writer).getByText('sub/71273-grid')).toBeTruthy();
  });

  it('a reviewer queued until Code review shows "Starts at the Code review stage"', async () => {
    renderPanel('implementing');
    const reviewer = await screen.findByTestId('sub-agent-reviewer');
    expect(within(reviewer).getByText('Queued')).toBeTruthy();
    expect(within(reviewer).getByText('Starts at the Code review stage')).toBeTruthy();
  });

  it('at Code review the queued reviewer shows what it will do', async () => {
    renderPanel('code-review');
    const reviewer = await screen.findByTestId('sub-agent-reviewer');
    expect(within(reviewer).getByText('Review the cutover')).toBeTruthy();
  });

  it('follows agent:subagent events', async () => {
    const { client } = renderPanel();
    await screen.findByTestId('sub-agent-reviewer');
    const handlers = subAgentEventHandlers(client);
    act(() =>
      handlers['agent:subagent']?.({
        ticketId: '71273',
        at: 10,
        change: 'finished',
        node: { ...tree.nodes[1]!, status: 'done', activity: 'Grid templates done', endedAt: 10 },
        counts: { running: 1, done: 2, queued: 1, failed: 0 },
      }),
    );
    await waitFor(() => expect(screen.getByText('1 running · 2 done · 1 queued')).toBeTruthy());
    expect(within(screen.getByTestId('sub-agent-razor-writer')).getByText('Grid templates done')).toBeTruthy();

    act(() =>
      handlers['agent:subagent']?.({
        ticketId: '71273',
        at: 11,
        change: 'started',
        node: node({ id: 'grid-helper', parentId: 'razor-writer', startedAt: 11, activity: 'Splitting the column template' }),
        counts: { running: 2, done: 2, queued: 1, failed: 0 },
      }),
    );
    const helper = await screen.findByTestId('sub-agent-grid-helper');
    expect(helper).toBeTruthy();
  });

  it('lists second agents with their role, state and Open / Stop / Remove (AL-266)', async () => {
    const bridge = installFakeBridge({
      'agent:getSubagents': { ok: true, data: { ...tree, leadTokens: 0, nodes: [], counts: { running: 0, done: 0, queued: 0, failed: 0 } } },
      'agent:stop': { ok: true, data: { stopped: true, status: { ticketId: '71273-reviewer-eyes', state: 'stopped', sessionId: null, message: null } } },
      'tickets:archive': { ok: true, data: { status: 'archived', archived: { archivedAt: 1, record: fakeTicketRecord({ id: '71273-helper-docs' }), deletedBranches: [], keptBranches: ['sub/71273-docs'] } } },
    });
    const replies = vi.mocked(bridge.invoke).getMockImplementation()!;
    vi.mocked(bridge.invoke).mockImplementation(async (channel: string, payload?: unknown) => {
      const ticketId = (payload as { ticketId: string } | undefined)?.ticketId ?? '';
      if (channel === 'agent:getStatus') return { ok: true, data: { ticketId, state: ticketId.includes('reviewer') ? 'running' : 'stopped', sessionId: null, message: null } };
      if (channel === 'agent:getUsage') return { ok: true, data: { ...emptyAgentUsage(ticketId), leadTokens: 12_000, totalTokens: 12_000 } };
      return replies(channel as never, payload as never);
    });
    const onOpen = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const lead = fakeTicketRecord({ id: '71273' });
    const companions = [
      fakeTicketRecord({ id: '71273-reviewer-eyes', ado: null, companion: { of: '71273', role: 'reviewer', name: 'Eyes' } }),
      fakeTicketRecord({ id: '71273-helper-docs', ado: null, branch: 'sub/71273-docs', companion: { of: '71273', role: 'helper', name: 'Docs' } }),
    ];
    agentTickets.load([lead, ...companions]);
    agentTickets.setSession('71273-reviewer-eyes', 'running');
    agentTickets.setSession('71273-helper-docs', 'stopped');
    render(
      <QueryClientProvider client={client}>
        <AgentsPanel ticket={ticketFromRecord(lead)} companions={companions} activeId="71273" onOpenCompanion={onOpen} />
      </QueryClientProvider>,
    );
    const reviewer = screen.getByTestId('companion-71273-reviewer-eyes');
    expect(within(reviewer).getByText('Eyes')).toBeTruthy();
    expect(within(reviewer).getByText('Reviewer')).toBeTruthy();
    expect(within(reviewer).getByText('Read-only, in the ticket worktree')).toBeTruthy();
    expect(within(reviewer).getByText('Running')).toBeTruthy();
    expect(await within(reviewer).findByText('12k tokens')).toBeTruthy();
    const helper = screen.getByTestId('companion-71273-helper-docs');
    expect(within(helper).getByText('Docs')).toBeTruthy();
    expect(within(helper).getByText('Helper')).toBeTruthy();
    expect(within(helper).getByText('sub/71273-docs')).toBeTruthy();
    expect(within(helper).getByText('Done')).toBeTruthy();

    fireEvent.click(screen.getByTestId('companion-71273-reviewer-eyes-open'));
    expect(onOpen).toHaveBeenCalledWith('71273-reviewer-eyes');
    fireEvent.click(screen.getByTestId('companion-71273-reviewer-eyes-stop'));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('agent:stop', { ticketId: '71273-reviewer-eyes' }));
    fireEvent.click(screen.getByTestId('companion-71273-helper-docs-remove'));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('tickets:archive', { ticketId: '71273-helper-docs', confirmed: true }));
  });

  it('says none yet before any sub-agent', async () => {
    installFakeBridge({ 'agent:getSubagents': { ok: true, data: { ...tree, leadTokens: 0, nodes: [], counts: { running: 0, done: 0, queued: 0, failed: 0 } } } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    agentTickets.load([fakeTicketRecord({ id: '71273' })]);
    render(
      <QueryClientProvider client={client}>
        <AgentsPanel ticket={ticketFromRecord(fakeTicketRecord({ id: '71273' }))} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText(/working alone/)).toBeTruthy());
    expect(screen.getByTestId('sub-agents-counts').textContent).toBe('None yet');
  });
});
