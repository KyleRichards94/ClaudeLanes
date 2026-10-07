import { QueryClient, QueryClientProvider, focusManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignArtboardList } from '@agent-lanes/contracts';
import { getSelectedArtboards, resetArtboardSelection } from '@/shared/model';
import { installFakeBridge, type FakeBridge } from '@/shared/testing';
import { HandOffSection } from './HandOffSection';

vi.setConfig({ testTimeout: 30_000 });

const CANVAS = 'https://claude.ai/design/p/p-71273';
const CONTROL = { id: 'job-control.html', name: 'JobControl · desktop', width: 1440, height: 900 };
const FIRST: DesignArtboardList = {
  status: 'ok',
  readAt: 1,
  artboards: [
    CONTROL,
    { id: 'job-filter.html', name: 'JobFilter · side panel', width: 420, height: 900 },
    { id: 'empty.html', name: 'Empty state', width: 600, height: 320 },
  ],
};

let bridge: FakeBridge;
let reply: unknown;

function answerWith(list: DesignArtboardList | { ok: false; code: string; message: string }) {
  reply = 'status' in list ? { ok: true, data: list } : list;
}

function listCalls(): number {
  return vi.mocked(bridge.invoke).mock.calls.filter(([channel]) => channel === 'design:listArtboards').length;
}

function renderSection(canvasUrl: string | null = CANVAS) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <HandOffSection ticketId="71273" canvasUrl={canvasUrl ?? undefined} />
    </QueryClientProvider>,
  );
}

describe('HandOffSection (AL-195)', () => {
  beforeEach(() => {
    resetArtboardSelection();
    answerWith(FIRST);
    bridge = installFakeBridge({});
    vi.mocked(bridge.invoke).mockImplementation(async (channel) =>
      channel === 'design:listArtboards' ? reply : { ok: false, code: 'INTERNAL', message: 'no fake reply' },
    );
  });

  afterEach(() => {
    focusManager.setFocused(undefined);
  });

  it("lists the canvas's artboards with names and sizes", async () => {
    renderSection();
    expect(await screen.findByRole('checkbox', { name: 'JobControl · desktop, 1440×900' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'JobFilter · side panel, 420×900' })).toBeTruthy();
    expect(screen.getByText('600×320')).toBeTruthy();
    expect(vi.mocked(bridge.invoke)).toHaveBeenCalledWith('design:listArtboards', { ticketId: '71273' });
  });

  it('checks artboards for the hand-off', async () => {
    renderSection();
    const control = await screen.findByRole('checkbox', { name: 'JobControl · desktop, 1440×900' });
    expect(screen.getByRole('button', { name: 'Send 0 artboards to agent as spec' })).toBeTruthy();

    fireEvent.click(control);
    fireEvent.click(screen.getByRole('checkbox', { name: 'JobFilter · side panel, 420×900' }));
    expect(control.getAttribute('aria-checked')).toBe('true');
    expect(getSelectedArtboards('71273')).toEqual(['job-control.html', 'job-filter.html']);
    expect(screen.getByRole('button', { name: 'Send 2 artboards to agent as spec' })).toBeTruthy();

    fireEvent.click(control);
    expect(getSelectedArtboards('71273')).toEqual(['job-filter.html']);
  });

  it('refreshes when artboards are added or renamed on the canvas, and drops picks no longer there', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'JobFilter · side panel, 420×900' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Empty state, 600×320' }));

    // On the canvas: JobFilter renamed (its file too), a Mobile artboard added.
    answerWith({
      status: 'ok',
      readAt: 2,
      artboards: [
        CONTROL,
        { id: 'job-filter-panel.html', name: 'JobFilter · panel', width: 420, height: 900 },
        { id: 'empty.html', name: 'Empty state', width: 600, height: 320 },
        { id: 'mobile.html', name: 'JobControl · mobile', width: 390, height: 844 },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh artboards' }));

    expect(await screen.findByRole('checkbox', { name: 'JobControl · mobile, 390×844' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'JobFilter · panel, 420×900' })).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: 'JobFilter · side panel, 420×900' })).toBeNull();
    await waitFor(() => expect(getSelectedArtboards('71273')).toEqual(['empty.html']));
    expect(screen.getByText('4 artboards')).toBeTruthy();
  });

  it('reads the list again when the window regains focus', async () => {
    renderSection();
    await screen.findByRole('checkbox', { name: 'JobControl · desktop, 1440×900' });
    const before = listCalls();

    act(() => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(listCalls()).toBe(before + 1));
  });

  it('says why when Claude Design is not available for the login', async () => {
    answerWith({ status: 'unavailable', reason: "Claude Design isn't available for this Claude login." });
    renderSection();
    expect(await screen.findByText("Claude Design isn't available for this Claude login.")).toBeTruthy();
  });

  it('shows a failed read', async () => {
    answerWith({ ok: false, code: 'INTERNAL', message: 'Reading the artboards took too long.' });
    renderSection();
    expect(await screen.findByText('Reading the artboards took too long.')).toBeTruthy();
  });

  it('reads nothing while no canvas is linked', () => {
    renderSection(null);
    expect(screen.getByText('Link a canvas to pick the artboards the agent should build from.')).toBeTruthy();
    expect(listCalls()).toBe(0);
  });
});
