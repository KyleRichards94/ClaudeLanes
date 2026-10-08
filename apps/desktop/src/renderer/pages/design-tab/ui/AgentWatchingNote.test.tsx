import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvokeChannel, TicketDesignSpec, TicketRecord } from '@agent-lanes/contracts';
import { agentTickets } from '@/entities/agent-ticket';
import { createDesignSpecEventHandlers } from '@/shared/api';
import { resetDesignViews, resetTicketPageTabs, useUiPrefs } from '@/shared/model';
import { RouterProvider, createRouter, routes } from '@/shared/routing';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { AgentWatchingNote } from './AgentWatchingNote';
import { DesignTabPage } from './DesignTabPage';

vi.setConfig({ testTimeout: 30_000 });

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const at1401 = new Date(2026, 9, 8, 14, 1).getTime();

function spec(version: number, fields: Partial<TicketDesignSpec> = {}): TicketDesignSpec {
  return { version, shippedAt: at1401 - 60_000, approvedBy: 'Kyle', artboardCount: 2, usedAt: null, fetchedAt: null, ...fields };
}

function recordWith(specs: TicketDesignSpec[]): TicketRecord {
  return fakeTicketRecord({ design: { canvas: null, lastViewUrl: null, specs } });
}

describe('Agent is watching this canvas (AL-198)', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    agentTickets.load([]);
    resetDesignViews();
    resetTicketPageTabs();
    useUiPrefs.setState({ embedModeByTicket: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows only while the latest spec is fetched and not yet acknowledged', () => {
    const { rerender } = render(<AgentWatchingNote specs={[]} />);
    expect(screen.queryByTestId('design-agent-watching')).toBeNull();
    rerender(<AgentWatchingNote specs={[spec(1)]} />);
    expect(screen.queryByTestId('design-agent-watching')).toBeNull();
    rerender(<AgentWatchingNote specs={[spec(1, { fetchedAt: at1401 })]} />);
    expect(screen.getByTestId('design-agent-watching').textContent).toContain('Agent is watching this canvas');
    expect(screen.getByTestId('design-agent-watching').textContent).toContain('Design v1');
    rerender(<AgentWatchingNote specs={[spec(1, { fetchedAt: at1401, usedAt: at1401 })]} />);
    expect(screen.queryByTestId('design-agent-watching')).toBeNull();
    // A newer spec the agent has not read yet: it is not watching that one.
    rerender(<AgentWatchingNote specs={[spec(1, { fetchedAt: at1401 }), spec(2)]} />);
    expect(screen.queryByTestId('design-agent-watching')).toBeNull();
  });

  it('turns into "Used · 14:01" in Attached to this ticket when the agent acknowledges, live from design:spec', async () => {
    let record = recordWith([spec(1, { fetchedAt: at1401 })]);
    const bridge = installFakeBridge();
    vi.mocked(bridge.invoke).mockImplementation(async (channel: InvokeChannel) => {
      if (channel === 'tickets:get') return { ok: true, data: { record } };
      if (channel === 'design:getView') return { ok: true, data: { view: null } };
      return { ok: false, code: 'INTERNAL', message: 'no fake reply' };
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={createRouter(routes.ticketDesign('71273'))}>
          <DesignTabPage ticketId="71273" />
        </RouterProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('design-agent-watching')).toBeTruthy();
    const attached = screen.getByTestId('design-attached');
    expect(within(attached).getByText('Sent')).toBeTruthy();

    // The agent calls ack_design_spec: main saves "used" and sends design:spec.
    record = recordWith([spec(1, { fetchedAt: at1401, usedAt: at1401 })]);
    act(() => createDesignSpecEventHandlers(client)['design:spec']?.({ ticketId: '71273', at: at1401, version: 1, change: 'used' }));

    await waitFor(() => expect(within(screen.getByTestId('design-attached')).getByText('Used · 14:01')).toBeTruthy());
    expect(screen.queryByTestId('design-agent-watching')).toBeNull();
  });
});
