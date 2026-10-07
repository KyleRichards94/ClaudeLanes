import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RouterProvider, createRouter, routes, selectRoute } from '@/shared/routing';
import { TicketPage } from './TicketPage';

function renderPage(ticketId: string) {
  const router = createRouter(routes.ticket(ticketId));
  render(
    <RouterProvider router={router}>
      <TicketPage ticketId={ticketId} />
    </RouterProvider>,
  );
  return router;
}

describe('TicketPage', () => {
  it('names the ticket', () => {
    renderPage('71273');
    expect(screen.getByRole('heading', { name: '#71273' })).toBeTruthy();
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
