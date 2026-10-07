import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { adoFixture } from '@agent-lanes/contracts/testing';
import { RouterProvider, createRouter, routes, selectRoute } from '@/shared/routing';
import { installFakeBridge, type FakeBridge } from '@/shared/testing';
import { TicketPage } from './TicketPage';

const [item] = adoFixture().workItems;
let bridge: FakeBridge;

function renderPage(ticketId: string) {
  const router = createRouter(routes.ticket(ticketId));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router}>
        <TicketPage ticketId={ticketId} />
      </RouterProvider>
    </QueryClientProvider>,
  );
  return router;
}

describe('TicketPage', () => {
  beforeEach(() => {
    bridge = installFakeBridge({ 'ado:getWorkItem': { ok: true, data: item } });
  });

  it('names the ticket', () => {
    renderPage('71273');
    expect(screen.getByRole('heading', { name: '#71273' })).toBeTruthy();
  });

  it('shows the work item from Azure DevOps (AL-066)', async () => {
    renderPage('71273');
    expect(await screen.findByTestId('ticket-work-item')).toBeTruthy();
    expect(screen.getByText('Cutover frmJobControl to Blazor')).toBeTruthy();
    expect(bridge.invoke).toHaveBeenCalledWith('ado:getWorkItem', { id: 71273 });
  });

  it('asks Azure DevOps for nothing when the ticket has no work item', () => {
    renderPage('nt-20261007-fix-the-login');
    expect(bridge.invoke).not.toHaveBeenCalledWith('ado:getWorkItem', expect.anything());
  });

  it('goes to the board', () => {
    const router = renderPage('71273');
    fireEvent.click(screen.getByText('← Board'));
    expect(selectRoute(router.getState())).toEqual(routes.board());
  });

  it("opens the ticket's Claude Design tab", () => {
    const router = renderPage('71273');
    fireEvent.click(screen.getByText('Claude Design ↗'));
    expect(selectRoute(router.getState())).toEqual(routes.ticketDesign('71273'));
  });

  it("shows the ticket's build log", () => {
    renderPage('71273');
    expect(screen.getByRole('heading', { name: 'Build log' })).toBeTruthy();
    expect(screen.getByTestId('build-log')).toBeTruthy();
  });
});
