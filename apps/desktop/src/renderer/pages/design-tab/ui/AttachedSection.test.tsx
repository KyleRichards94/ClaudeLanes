import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesignSpec, InvokeChannel, TicketDesignSpec } from '@agent-lanes/contracts';
import { installFakeBridge, type FakeBridge } from '@/shared/testing';
import { AttachedSection } from './AttachedSection';

vi.setConfig({ testTimeout: 30_000 });

const at = (hour: number, minute: number) => new Date(2026, 9, 8, hour, minute).getTime();

const CONTROL = { id: 'JobControl.html', name: 'JobControl · desktop', width: 1440, height: 900, source: '<main/>' };
const FILTER = { id: 'JobFilter.html', name: 'JobFilter · side panel', width: 420, height: 900, source: null };
const EMPTY = { id: 'Empty.html', name: 'Empty state', width: 600, height: 320, source: '<div/>' };

function fullSpec(version: number, artboards: DesignSpec['artboards'], fields: Partial<DesignSpec> = {}): DesignSpec {
  return {
    ticketId: '71273',
    version,
    shippedAt: at(13, 50 + version),
    approvedBy: 'Kyle',
    note: '',
    canvasUrl: 'https://claude.ai/design/p/p-71273',
    tokensFile: 'agent-lanes-tokens.css',
    artboards,
    supersedes: version > 1 ? version - 1 : null,
    reshipOf: null,
    ...fields,
  };
}

const SPECS: Record<number, DesignSpec> = {
  1: fullSpec(1, [CONTROL, FILTER]),
  2: fullSpec(2, [{ ...CONTROL, width: 1600 }, EMPTY], { note: 'Wider grid' }),
};

function entry(version: number, fields: Partial<TicketDesignSpec> = {}): TicketDesignSpec {
  return { version, shippedAt: at(13, 50 + version), approvedBy: 'Kyle', artboardCount: SPECS[version]?.artboards.length ?? 1, usedAt: null, fetchedAt: null, deliveredAt: null, ...fields };
}

let bridge: FakeBridge;

function renderSection(specs: TicketDesignSpec[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AttachedSection ticketId="71273" specs={specs} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  bridge = installFakeBridge();
  vi.mocked(bridge.invoke).mockImplementation(async (channel: InvokeChannel, payload?: unknown) => {
    const version = (payload as { version?: number } | undefined)?.version;
    if (channel === 'design:getSpec') return version && SPECS[version] ? { ok: true, data: SPECS[version] } : { ok: false, code: 'VALIDATION', message: 'no such version' };
    if (channel === 'design:reshipSpec') return { ok: true, data: { spec: entry(3, { artboardCount: 2 }), delivered: true } };
    return { ok: false, code: 'INTERNAL', message: 'no fake reply' };
  });
});

describe('Attached to this ticket (AL-199)', () => {
  it('lists every version newest first with Sent, Used · time and Superseded, and the design-system file', () => {
    renderSection([entry(1, { usedAt: at(13, 55) }), entry(2, { usedAt: at(14, 1) })]);
    const section = screen.getByTestId('design-attached');
    const rows = within(section).getAllByRole('button');
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual(['Design v2, 2 artboards, Used · 14:01', 'Design v1, 2 artboards, Superseded']);
    expect(within(section).getByText('agent-lanes-tokens.css')).toBeTruthy();
    expect(within(section).getByText('Design system')).toBeTruthy();
  });

  it('shows Sent until the agent acknowledges the latest version', () => {
    renderSection([entry(1)]);
    expect(screen.getByTestId('design-spec-v1-status').textContent).toBe('Sent');
  });

  it("opens a version: its artboards, note and what changed from the version before", async () => {
    renderSection([entry(1), entry(2)]);
    fireEvent.click(screen.getByRole('button', { name: /Design v2/ }));

    const details = await screen.findByTestId('design-spec-v2-details');
    await waitFor(() => expect(within(details).getByText('Wider grid', { exact: false })).toBeTruthy());
    expect(within(details).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['JobControl · desktop1600×900', 'Empty state600×320']);
    await waitFor(() =>
      expect(screen.getByTestId('design-spec-v2-diff').textContent).toBe('Since v1: added Empty state · removed JobFilter · side panel · changed JobControl · desktop'),
    );
    // The latest version can't be shipped again; it is already the one the agent has.
    expect(screen.queryByTestId('design-spec-v2-reship')).toBeNull();
    expect(screen.getByRole('button', { name: /Design v2/ }).getAttribute('aria-expanded')).toBe('true');
  });

  it('ships an earlier version again', async () => {
    renderSection([entry(1), entry(2)]);
    fireEvent.click(screen.getByRole('button', { name: /Design v1/ }));
    const details = await screen.findByTestId('design-spec-v1-details');
    expect(within(details).getByText('no source')).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Ship v1 again' }));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('design:reshipSpec', { ticketId: '71273', version: 1 }));
  });
});
