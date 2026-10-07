import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LANES, type TicketRecord } from '@agent-lanes/contracts';
import { agentTickets } from '@/entities/agent-ticket';
import { designViewEventHandlers, resetDesignViews, resetTicketPageTabs, useUiPrefs } from '@/shared/model';
import { RouterProvider, createRouter, routes, selectRoute } from '@/shared/routing';
import { fakeTicketRecord, installFakeBridge, type FakeBridge } from '@/shared/testing';
import { DesignTabPage } from './DesignTabPage';

vi.setConfig({ testTimeout: 30_000 });

const CANVAS = { kind: 'design-project' as const, id: 'p-71273', url: 'https://claude.ai/design/p/p-71273' };
const LAST_URL = 'https://claude.ai/design/p/p-71273?artboard=2';

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function linkedRecord(overrides: Partial<TicketRecord> = {}): TicketRecord {
  return fakeTicketRecord({ design: { canvas: CANVAS, lastViewUrl: LAST_URL, specs: [] }, ...overrides });
}

function renderPage(record: TicketRecord | null, extra: Record<string, unknown> = {}) {
  const bridge = installFakeBridge({
    'tickets:get': { ok: true, data: { record } },
    'design:getView': { ok: true, data: { view: null } },
    'design:openCanvas': { ok: true, data: { ticketId: '71273', status: 'loading', url: null, visible: true } },
    'design:hide': { ok: true, data: { found: true } },
    'design:setBounds': { ok: true, data: { found: true } },
    'design:reload': { ok: true, data: { found: true } },
    ...extra,
  });
  const router = createRouter(routes.ticketDesign(record?.id ?? '71273'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router}>
        <DesignTabPage ticketId={record?.id ?? '71273'} />
      </RouterProvider>
    </QueryClientProvider>,
  );
  return { router, bridge };
}

function calls(bridge: FakeBridge, channel: string): unknown[] {
  return vi.mocked(bridge.invoke).mock.calls.filter(([name]) => name === channel).map(([, payload]) => payload);
}

function viewEvent(status: 'loading' | 'signed-in' | 'signed-out' | 'load-failed') {
  act(() => {
    designViewEventHandlers['design:view']?.({ ticketId: '71273', at: Date.now(), status, url: LAST_URL, visible: true, closed: false });
  });
}

describe('DesignTabPage', () => {
  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    agentTickets.load([]);
    resetDesignViews();
    resetTicketPageTabs();
    installFakeBridge({});
    useUiPrefs.setState({ embedModeByTicket: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the compact ticket header and the tab bar with Claude Design selected', async () => {
    renderPage(fakeTicketRecord());

    expect(await screen.findByRole('heading', { name: 'Cutover frmJobControl to Blazor', level: 1 })).toBeTruthy();
    expect(screen.getByTestId('design-stage-pill').textContent).toBe('Implementing');
    expect(screen.getByText('Opus · XHigh')).toBeTruthy();
    expect(screen.getByText('#71273')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Claude Design' }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows the stage progress in the header pill', async () => {
    renderPage(fakeTicketRecord());
    await screen.findByTestId('design-stage-pill');
    act(() => agentTickets.setActivity('71273', { text: 'Wiring filters', progress: 0.46 }, 5_000));
    expect(screen.getByTestId('design-stage-pill').textContent).toBe('Implementing · 46%');
  });

  it('is open and usable in every stage, Queued through Done (R11)', async () => {
    for (const stage of LANES) {
      agentTickets.load([]);
      const { bridge } = renderPage(linkedRecord({ stage }));
      expect(await screen.findByTestId('design-canvas-slot')).toBeTruthy();
      await waitFor(() => expect(calls(bridge, 'design:openCanvas')).toHaveLength(1));
      expect(screen.getByRole('tab', { name: 'Claude Design' })).toBeTruthy();
      expect(screen.getByTestId('design-side-panel')).toBeTruthy();
      cleanup();
    }
  });

  it('asks main to open the linked canvas over the placeholder', async () => {
    const { bridge } = renderPage(linkedRecord());
    await screen.findByTestId('design-canvas-slot');
    await waitFor(() => expect(calls(bridge, 'design:openCanvas')).toEqual([expect.objectContaining({ ticketId: '71273' })]));
    expect(screen.getByTestId('design-canvas-label').textContent).toBe('claude.ai/design · 71273 canvas');
  });

  it("shows the view's real state in the webview pill", async () => {
    renderPage(linkedRecord());
    await screen.findByTestId('design-canvas-slot');

    expect(screen.getByTestId('design-view-status').textContent).toBe('Webview · loading');
    viewEvent('signed-in');
    expect(screen.getByTestId('design-view-status').textContent).toBe('Webview · signed in');
    viewEvent('signed-out');
    expect(screen.getByTestId('design-view-status').textContent).toBe('Webview · sign-in needed');
    viewEvent('load-failed');
    expect(screen.getByTestId('design-view-status').textContent).toBe("Webview · couldn't load");
  });

  it('reloads the canvas and opens it in Claude from the browser bar', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { bridge } = renderPage(linkedRecord());
    await screen.findByTestId('design-canvas-slot');
    viewEvent('signed-in');

    fireEvent.click(screen.getByRole('button', { name: 'Reload canvas' }));
    expect(calls(bridge, 'design:reload')).toEqual([{ ticketId: '71273' }]);

    fireEvent.click(screen.getByRole('button', { name: 'Open in Claude' }));
    expect(open).toHaveBeenCalledWith(LAST_URL, '_blank', 'noopener');
    open.mockRestore();
  });

  it('offers to link a canvas when none is linked, and opens no view', async () => {
    const { bridge } = renderPage(fakeTicketRecord());
    expect(await screen.findByTestId('link-canvas-form')).toBeTruthy();
    expect(screen.getByTestId('design-canvas-label').textContent).toBe('No canvas linked');
    expect(calls(bridge, 'design:openCanvas')).toEqual([]);
  });

  it('refuses a link that is not a canvas before sending it', async () => {
    const { bridge } = renderPage(fakeTicketRecord());
    fireEvent.change(await screen.findByTestId('link-canvas-url'), { target: { value: 'https://claude.ai/chat/abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link canvas' }));

    expect(await screen.findByText(/isn't a Claude Design canvas link/)).toBeTruthy();
    expect(calls(bridge, 'design:linkCanvas')).toEqual([]);
  });

  it('links a pasted canvas and shows it', async () => {
    const { bridge } = renderPage(fakeTicketRecord(), {
      'design:linkCanvas': { ok: true, data: { canvas: CANVAS, lastViewUrl: null, specs: [] } },
    });
    fireEvent.change(await screen.findByTestId('link-canvas-url'), { target: { value: 'claude.ai/design/p/p-71273' } });
    fireEvent.click(screen.getByRole('button', { name: 'Link canvas' }));

    expect(await screen.findByTestId('design-canvas-slot')).toBeTruthy();
    expect(calls(bridge, 'design:linkCanvas')).toEqual([{ ticketId: '71273', url: 'claude.ai/design/p/p-71273' }]);
    await waitFor(() => expect(calls(bridge, 'design:openCanvas')).toHaveLength(1));
  });

  it('shows what main says when it refuses a link', async () => {
    renderPage(fakeTicketRecord(), { 'design:linkCanvas': { ok: false, code: 'VALIDATION', message: 'There is no ticket 71273' } });
    fireEvent.change(await screen.findByTestId('link-canvas-url'), { target: { value: CANVAS.url } });
    fireEvent.click(screen.getByRole('button', { name: 'Link canvas' }));
    expect(await screen.findByText('There is no ticket 71273')).toBeTruthy();
  });

  it('changes or unlinks a linked canvas', async () => {
    const { bridge } = renderPage(linkedRecord(), {
      'design:unlinkCanvas': { ok: true, data: { canvas: null, lastViewUrl: null, specs: [] } },
    });
    await screen.findByTestId('design-canvas-slot');

    fireEvent.click(screen.getByRole('button', { name: 'Change canvas' }));
    expect(screen.queryByTestId('design-canvas-slot')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByTestId('design-canvas-slot')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Change canvas' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unlink canvas' }));
    await waitFor(() => expect(calls(bridge, 'design:unlinkCanvas')).toEqual([{ ticketId: '71273' }]));
    expect(await screen.findByRole('heading', { name: 'Link a Claude Design canvas' })).toBeTruthy();
  });

  it('lists shipped specs with Sent, Used and Superseded, and the design system file', async () => {
    const usedAt = new Date(2026, 9, 7, 14, 1).getTime();
    renderPage(
      fakeTicketRecord({
        design: {
          canvas: null,
          lastViewUrl: null,
          specs: [
            { version: 1, shippedAt: 1, approvedBy: 'Kyle', artboardCount: 1, usedAt },
            { version: 2, shippedAt: 2, approvedBy: 'Kyle', artboardCount: 2, usedAt },
          ],
        },
      }),
    );
    expect(await screen.findByText('Design v2 · 2 artboards')).toBeTruthy();
    expect(screen.getByText('Used · 14:01')).toBeTruthy();
    expect(screen.getByText('Superseded')).toBeTruthy();
    expect(screen.getByText('agent-lanes-tokens.css')).toBeTruthy();
  });

  it('goes back to the drill-in on the tab picked', async () => {
    const { router } = renderPage(fakeTicketRecord());
    fireEvent.click(await screen.findByRole('tab', { name: 'Diff' }));
    expect(selectRoute(router.getState())).toEqual(routes.ticket('71273'));
  });

  it('goes to the board', async () => {
    const { router } = renderPage(fakeTicketRecord());
    fireEvent.click(await screen.findByRole('button', { name: '← Board' }));
    expect(selectRoute(router.getState())).toEqual(routes.board());
  });

  describe('embed mode (AL-194)', () => {
    it('switches between Webview and MCP link, saved per ticket', async () => {
      const open = vi.spyOn(window, 'open').mockImplementation(() => null);
      renderPage(linkedRecord());
      await screen.findByTestId('design-canvas-slot');

      const webview = screen.getByRole('radio', { name: 'Webview, Electron WebContentsView' });
      const mcp = screen.getByRole('radio', { name: 'MCP link, Open in Claude, sync via MCP' });
      expect(webview.getAttribute('aria-checked')).toBe('true');
      expect(screen.getByText(/A plain iframe is likely blocked by claude.ai frame headers/)).toBeTruthy();

      fireEvent.click(mcp);
      expect(useUiPrefs.getState().embedModeByTicket['71273']).toBe('mcp-link');
      expect(screen.queryByTestId('design-canvas-slot')).toBeNull();
      expect(screen.getByTestId('design-mcp-link')).toBeTruthy();
      expect(screen.getByTestId('design-view-status').textContent).toBe('MCP link · opens in Claude');
      expect(screen.getByText(/claude \/design login/)).toBeTruthy();

      fireEvent.click(within(screen.getByTestId('design-mcp-link')).getByRole('button', { name: 'Open in Claude' }));
      expect(open).toHaveBeenCalledWith(LAST_URL, '_blank', 'noopener');
      open.mockRestore();

      fireEvent.click(webview);
      expect(useUiPrefs.getState().embedModeByTicket['71273']).toBe('webview');
      expect(await screen.findByTestId('design-canvas-slot')).toBeTruthy();
    });

    it('opens a ticket in the mode saved for it', async () => {
      useUiPrefs.setState({ embedModeByTicket: { '71273': 'mcp-link' } });
      const { bridge } = renderPage(linkedRecord());
      expect(await screen.findByTestId('design-mcp-link')).toBeTruthy();
      expect(calls(bridge, 'design:openCanvas')).toEqual([]);
    });

    it('offers MCP link mode when the webview cannot sign in', async () => {
      renderPage(linkedRecord());
      await screen.findByTestId('design-canvas-slot');
      expect(screen.queryByTestId('embed-mode-fallback')).toBeNull();

      viewEvent('signed-out');
      expect(screen.getByTestId('embed-mode-fallback').textContent).toMatch(/Google sign-in is refused inside apps/);
      fireEvent.click(screen.getByRole('button', { name: 'Use MCP link' }));

      expect(useUiPrefs.getState().embedModeByTicket['71273']).toBe('mcp-link');
      expect(screen.getByTestId('design-mcp-link')).toBeTruthy();
      expect(screen.queryByTestId('embed-mode-fallback')).toBeNull();
    });

    it('offers it too when the canvas fails to load', async () => {
      renderPage(linkedRecord());
      await screen.findByTestId('design-canvas-slot');
      viewEvent('load-failed');
      expect(screen.getByText("The canvas couldn't load here.")).toBeTruthy();
    });
  });
});
