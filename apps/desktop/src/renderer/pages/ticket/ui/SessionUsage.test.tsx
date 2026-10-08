import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyAgentUsage, type AgentUsage } from '@agent-lanes/contracts';
import { adoFixtureWorkItem } from '@agent-lanes/contracts/testing';
import { agentTickets } from '@/entities/agent-ticket';
import { resetTicketPageTabs } from '@/shared/model';
import { RouterProvider, createRouter, routes } from '@/shared/routing';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { TicketPage } from './TicketPage';

vi.setConfig({ testTimeout: 30_000 });

const usage: AgentUsage = {
  ...emptyAgentUsage('71273'),
  totalTokens: 412_300,
  leadTokens: 211_800,
  costUsd: 3.456,
  turns: 7,
  context: { usedTokens: 50_000, maxTokens: 200_000, percentage: 25 },
  updatedAt: 9,
};

describe('session pill and lead agent tokens (AL-113)', () => {
  beforeEach(() => {
    agentTickets.load([]);
    resetTicketPageTabs();
    installFakeBridge({
      'tickets:get': { ok: true, data: { record: fakeTicketRecord({ sessionId: 'cc-71273' }) } },
      'ado:getWorkItem': { ok: true, data: adoFixtureWorkItem(71273) },
      'agent:getUsage': { ok: true, data: usage },
    });
  });

  it('shows the session tokens, the lead agent tokens, and the cost only in a tooltip', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={createRouter(routes.ticket('71273'))}>
          <TicketPage ticketId="71273" />
        </RouterProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText(/^Session cc-71273 · .* · 412k tokens$/)).toBeTruthy();
    expect((await screen.findByTestId('lead-agent-tokens')).textContent).toBe('212k tokens');
    expect(screen.queryByText(/\$3\.46/)).toBeNull();

    fireEvent.focus(screen.getByTestId('session-pill-anchor'));
    expect((await screen.findByRole('tooltip')).textContent).toBe('Cost about $3.46 · Context 25% of 200k · 7 turns');
  });
});
