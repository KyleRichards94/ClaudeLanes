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

function renderPrompt(props: Partial<Parameters<typeof PermissionPrompt>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EventRoute client={client} />
      <PermissionPrompt ticketId="71273" {...props} />
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
    // Deny… opens the reason box; Deny without a reason sends the plain denial.
    fireEvent.click(screen.getByRole('button', { name: 'Deny…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('agent:resolvePermission', { ticketId: '71273', requestId: 'request-1', decision: 'deny' }));

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

describe('PermissionPrompt at the waiting row (AL-260)', () => {
  const build: PermissionRequest = {
    ...request,
    requestId: 'request-2',
    title: 'Claude wants to run dotnet build',
    detail: 'dotnet build OnSite.sln -c Release',
    toolUseId: 'toolu_build',
    input: 'dotnet build OnSite.sln -c Release\n# Build the solution',
    suggestedRule: 'Bash(dotnet build:*)',
  };

  it('offers Always allow with the suggested rule, and Deny with a reason the agent reads', async () => {
    const bridge = installFakeBridge({
      'agent:getPermission': { ok: true, data: { request: build } },
      'agent:resolvePermission': { ok: true, data: { resolved: true } },
    });
    renderPrompt();

    // The whole input shows, not the clipped detail line.
    expect((await screen.findByTestId('permission-71273-detail')).textContent).toContain('# Build the solution');
    fireEvent.click(screen.getByRole('button', { name: 'Always allow Bash(dotnet build:*)' }));
    await waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('agent:resolvePermission', { ticketId: '71273', requestId: 'request-2', decision: 'allow-pattern', rule: 'Bash(dotnet build:*)' }),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Deny…' }));
    const reason = screen.getByTestId('permission-71273-deny-reason');
    fireEvent.change(reason, { target: { value: 'Use the cached build output' } });
    fireEvent.click(screen.getByTestId('permission-71273-deny-send'));
    await waitFor(() =>
      expect(bridge.invoke).toHaveBeenCalledWith('agent:resolvePermission', {
        ticketId: '71273',
        requestId: 'request-2',
        decision: 'deny',
        reason: 'Use the cached build output',
      }),
    );
  });

  it('renders inline only at its own tool use, and as one compact line at the top', async () => {
    installFakeBridge({ 'agent:getPermission': { ok: true, data: { request: build } }, 'agent:resolvePermission': { ok: true, data: { resolved: true } } });
    const { unmount } = renderPrompt({ variant: 'inline', toolUseIds: ['toolu_other'], testID: 'inline' });
    await waitFor(() => expect(screen.queryByTestId('inline')).toBeNull());
    unmount();

    const atRow = renderPrompt({ variant: 'inline', toolUseIds: ['toolu_build'], testID: 'inline' });
    expect(await screen.findByTestId('inline')).toBeTruthy();
    expect(screen.getByText('Needs you · allow Bash')).toBeTruthy();
    atRow.unmount();

    renderPrompt({ variant: 'compact' });
    expect((await screen.findByText('Needs you · allow Bash · dotnet build OnSite.sln -c Release')).textContent).toBeTruthy();
    expect(screen.queryByTestId('permission-71273-detail')).toBeNull();
    expect(screen.getByRole('button', { name: 'Allow once' })).toBeTruthy();
  });
});
