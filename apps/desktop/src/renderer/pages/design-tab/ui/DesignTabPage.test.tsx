import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RouterProvider, createRouter, routes, selectRoute } from '@/shared/routing';
import { DesignTabPage } from './DesignTabPage';

function renderPage(ticketId: string) {
  const router = createRouter(routes.ticketDesign(ticketId));
  render(
    <RouterProvider router={router}>
      <DesignTabPage ticketId={ticketId} />
    </RouterProvider>,
  );
  return router;
}

describe('DesignTabPage', () => {
  it('names the tab and the ticket', () => {
    renderPage('71273');
    expect(screen.getByRole('heading', { name: 'Claude Design' })).toBeTruthy();
    expect(screen.getByText('#71273')).toBeTruthy();
  });

  it('goes to the board', () => {
    const router = renderPage('71273');
    fireEvent.click(screen.getByText('← Board'));
    expect(selectRoute(router.getState())).toEqual(routes.board());
  });

  it("goes back to the ticket's output", () => {
    const router = renderPage('71273');
    fireEvent.click(screen.getByText('Output'));
    expect(selectRoute(router.getState())).toEqual(routes.ticket('71273'));
  });
});
