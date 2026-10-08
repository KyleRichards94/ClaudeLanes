import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { subscribe } from '@/shared/api';
import { installFakeBridge } from '@/shared/testing';
import { sessionStatusEventHandlers } from '../api/session-status';
import { QueuedNotice } from './QueuedNotice';

const queued = { ticketId: '71330', state: 'queued', sessionId: null, message: 'Waiting for a free slot' } as const;

function EventRoute({ client }: { client: QueryClient }) {
  useEffect(() => subscribe('agent:status', sessionStatusEventHandlers(client)['agent:status']!), [client]);
  return null;
}

function renderNotice() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EventRoute client={client} />
      <QueuedNotice ticketId="71330" />
    </QueryClientProvider>,
  );
}

describe('QueuedNotice (AL-111)', () => {
  it('shows "Waiting for a free slot" for a queued ticket and starts it on Start now', async () => {
    const bridge = installFakeBridge({
      'agent:getStatus': { ok: true, data: queued },
      'agent:startNow': { ok: true, data: { ticketId: '71330', state: 'running', sessionId: null, message: null } },
    });
    renderNotice();

    expect(await screen.findByText('Waiting for a free slot')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Start now' }));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('agent:startNow', { ticketId: '71330' }));
    await waitFor(() => expect(screen.queryByText('Waiting for a free slot')).toBeNull());
  });

  it('appears and goes with agent:status events', async () => {
    const bridge = installFakeBridge({ 'agent:getStatus': { ok: true, data: { ticketId: '71330', state: 'none', sessionId: null, message: null } } });
    renderNotice();
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('agent:getStatus', { ticketId: '71330' }));
    expect(screen.queryByRole('button', { name: 'Start now' })).toBeNull();

    act(() => bridge.emit('agent:status', { ...queued, at: 1 }));
    expect(await screen.findByRole('button', { name: 'Start now' })).toBeTruthy();

    // A slot freed: the session starts and the notice goes.
    act(() => bridge.emit('agent:status', { ticketId: '71330', at: 2, state: 'starting', sessionId: null, message: null }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Start now' })).toBeNull());
  });

  it('says why Start now failed', async () => {
    installFakeBridge({
      'agent:getStatus': { ok: true, data: queued },
      'agent:startNow': { ok: false, code: 'VALIDATION', message: 'Connect Claude in Connections before starting an agent.' },
    });
    renderNotice();
    fireEvent.click(await screen.findByRole('button', { name: 'Start now' }));
    expect(await screen.findByText(/Connect Claude in Connections/)).toBeTruthy();
  });
});
