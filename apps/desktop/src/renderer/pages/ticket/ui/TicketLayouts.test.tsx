import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adoFixtureWorkItem } from '@agent-lanes/contracts/testing';
import { agentTickets } from '@/entities/agent-ticket';
import { getTicketView, resetTicketViews, resetTicketPageTabs, selectFile, useUiPrefs } from '@/shared/model';
import { RouterProvider, createRouter, routes } from '@/shared/routing';
import { fakeTicketRecord, installFakeBridge, installFakeSettings } from '@/shared/testing';
import { TicketPage } from './TicketPage';
import type { TicketHeaderBandProps } from './TicketHeader';

vi.setConfig({ testTimeout: 30_000 });

// Counts how often the header band renders, to show a layout switch leaves it alone.
const headerRenders = vi.hoisted(() => ({ count: 0 }));
vi.mock('./TicketHeader', async (importOriginal) => {
  const original = await importOriginal<{ TicketHeaderBand: (props: TicketHeaderBandProps) => ReactNode }>();
  return {
    ...original,
    TicketHeaderBand: (props: TicketHeaderBandProps) => {
      headerRenders.count += 1;
      return original.TicketHeaderBand(props);
    },
  };
});
vi.mock('./CodeCityPanel', () => ({ default: () => <div data-testid="code-city-stub">city</div> }));

const record = fakeTicketRecord({ sessionId: 'cc-71273' });

function renderPage() {
  const router = createRouter(routes.ticket('71273'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router}>
        <TicketPage ticketId="71273" />
      </RouterProvider>
    </QueryClientProvider>,
  );
}

describe('ticket page layouts (AL-275)', () => {
  beforeEach(() => {
    installFakeSettings();
    useUiPrefs.setState({ ticketLayout: undefined });
    agentTickets.load([]);
    resetTicketPageTabs();
    resetTicketViews();
    headerRenders.count = 0;
    installFakeBridge({
      'tickets:get': { ok: true, data: { record } },
      'ado:getWorkItem': { ok: true, data: adoFixtureWorkItem(71273) },
    });
  });

  it('puts the layout slider in the header, on Flight deck by default, with today’s body under it', async () => {
    renderPage();
    await screen.findByTestId('ticket-title');
    const bar = screen.getByTestId('ticket-top-bar');
    const slider = within(bar).getByRole('radiogroup', { name: 'Ticket layout' });
    expect(within(slider).getByRole('radio', { name: 'Flight deck' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByTestId('layout-switch').getAttribute('data-layout')).toBe('flightDeck');
    expect(screen.getByTestId('ticket-stepper-band')).toBeTruthy();
    expect(screen.getByTestId('ticket-tab-panel')).toBeTruthy();
    expect(screen.queryByTestId('layout-pane-codeCity')).toBeNull();
  });

  it('switches to Code City from the slider, saves the choice and leaves the header alone', async () => {
    renderPage();
    await screen.findByTestId('ticket-title');
    const bar = screen.getByTestId('ticket-top-bar');
    await screen.findByTestId('session-pill');
    const pill = screen.getByTestId('session-pill');
    // Let the page settle (queries answered) so the render count below is steady.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const before = headerRenders.count;

    fireEvent.click(within(bar).getByRole('radio', { name: 'Code city' }));

    expect(useUiPrefs.getState().ticketLayout).toBe('codeCity');
    expect(await screen.findByTestId('code-city-stub')).toBeTruthy();
    expect(headerRenders.count).toBe(before);
    expect(screen.getByTestId('session-pill')).toBe(pill);
    expect(within(bar).getByRole('radio', { name: 'Code city' }).getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(screen.getByTestId('layout-pane-flightDeck').style.display).toBe('none'), { timeout: 2_000 });
    expect(headerRenders.count).toBe(before);
  });

  it('toggles with Ctrl+Shift+L from anywhere, and back', async () => {
    renderPage();
    await screen.findByTestId('ticket-title');

    fireEvent.keyDown(window, { key: 'L', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(useUiPrefs.getState().ticketLayout).toBe('codeCity'));
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(useUiPrefs.getState().ticketLayout).toBe('flightDeck'));
    // Other keys, and Ctrl+L alone, do nothing.
    fireEvent.keyDown(window, { key: 'l', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'x', ctrlKey: true, shiftKey: true });
    expect(useUiPrefs.getState().ticketLayout).toBe('flightDeck');
  });

  it('keeps the selected file when the layout changes', async () => {
    renderPage();
    await screen.findByTestId('ticket-title');
    selectFile('71273', 'src/Grid.razor');

    fireEvent.click(screen.getByRole('radio', { name: 'Code city' }));
    expect(await screen.findByTestId('code-city-stub')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Flight deck' }));
    expect(getTicketView('71273').selectedFilePath).toBe('src/Grid.razor');
  });

  it('does not stop a running turn on Ctrl+Shift+L, and Escape keeps its job', async () => {
    renderPage();
    const page = await screen.findByTestId('ticket-page');
    const interrupt = vi.mocked(window.agentLanes.invoke);
    fireEvent.keyDown(page, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'L', ctrlKey: true, shiftKey: true });
    expect(interrupt.mock.calls.some(([channel]) => channel === 'agent:interrupt')).toBe(false);
  });
});
