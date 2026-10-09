import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import type { AgentSubagents, SubagentNode } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { ticketFromRecord } from '@/entities/agent-ticket';
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
  const ticket = ticketFromRecord(fakeTicketRecord({ id: '71273', stage, model: 'opus', effort: 'xhigh' }));
  render(
    <QueryClientProvider client={client}>
      <AgentsPanel ticket={ticket} />
    </QueryClientProvider>,
  );
  return { client };
}

describe('AgentsPanel (AL-177)', () => {
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

  it('says none yet before any sub-agent', async () => {
    installFakeBridge({ 'agent:getSubagents': { ok: true, data: { ...tree, leadTokens: 0, nodes: [], counts: { running: 0, done: 0, queued: 0, failed: 0 } } } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AgentsPanel ticket={ticketFromRecord(fakeTicketRecord({ id: '71273' }))} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText(/working alone/)).toBeTruthy());
    expect(screen.getByTestId('sub-agents-counts').textContent).toBe('None yet');
  });
});
