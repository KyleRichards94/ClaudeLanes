import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import type { PermissionRequest } from '@agent-lanes/contracts';
import { createAgentTicketEventHandlers, createAgentTicketStore } from '@/entities/agent-ticket';
import { subscribe } from '@/shared/api';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { permissionEventHandlers } from '../api/permission';
import { PermissionPrompt } from './PermissionPrompt';

const request: PermissionRequest = {
  requestId: 'request-1',
  tool: 'Bash',
  title: 'Claude wants to run npm install',
  detail: 'npm install left-pad',
  openedAt: 1_000,
};

function EventRoute({ client }: { client: QueryClient }) {
  useEffect(() => subscribe('agent:permission', permissionEventHandlers(client)['agent:permission']!), [client]);
  return null;
}

function renderPrompt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EventRoute client={client} />
      <PermissionPrompt ticketId="71273" />
    </QueryClientProvider>,
  );
}

describe('PermissionPrompt (AL-109)', () => {
  it('shows a waiting request after a reload and sends Allow once', async () => {
    const bridge = installFakeBridge({
      'agent:getPermission': { ok: true, data: { request } },
      'agent:resolvePermission': { ok: true, data: { resolved: true } },
    });
    renderPrompt();

    expect(await screen.findByText('Needs you · allow Bash')).toBeTruthy();
    expect(screen.getByText('npm install left-pad')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }));
    await waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('agent:resolvePermission', { ticketId: '71273', requestId: 'request-1', decision: 'allow-once' }),
    );
  });

  it('appears and goes with agent:permission events, and sends Allow for this ticket and Deny', async () => {
    const bridge = installFakeBridge({
      'agent:getPermission': { ok: true, data: { request: null } },
      'agent:resolvePermission': { ok: true, data: { resolved: true } },
    });
    renderPrompt();
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('agent:getPermission', { ticketId: '71273' }));
    expect(screen.queryByText('Needs you · allow Bash')).toBeNull();

    act(() => bridge.emit('agent:permission', { ticketId: '71273', at: 1, state: 'waiting', request, waiting: request }));
    fireEvent.click(await screen.findByRole('button', { name: 'Allow for this ticket' }));
    await waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('agent:resolvePermission', { ticketId: '71273', requestId: 'request-1', decision: 'allow-ticket' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));

    act(() => bridge.emit('agent:permission', { ticketId: '71273', at: 2, state: 'allowed', request, waiting: null }));
    await waitFor(() => expect(screen.queryByText('Needs you · allow Bash')).toBeNull());
  });

  it('turns the card amber with "Needs you · allow Bash" while a request waits', () => {
    const store = createAgentTicketStore();
    store.load([fakeTicketRecord({ id: '71273', stage: 'implementing' })]);
    const handlers = createAgentTicketEventHandlers(store);
    handlers['agent:permission']!({ ticketId: '71273', at: 1, state: 'waiting', request, waiting: request });
    expect(store.getState().byId.get('71273')?.needsYou).toEqual([{ kind: 'permission', tool: 'Bash', since: 1_000 }]);
    handlers['agent:permission']!({ ticketId: '71273', at: 2, state: 'denied', request, waiting: null });
    expect(store.getState().byId.get('71273')?.needsYou).toEqual([]);
  });
});
