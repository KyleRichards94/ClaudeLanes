import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, type AgentSessionStatus } from '@agent-lanes/contracts';
import { fakeTicketRecord, installFakeBridge, type FakeBridge } from '@/shared/testing';
import { AgentMenu } from './AgentMenu';

const status = (state: AgentSessionStatus['state']): AgentSessionStatus => ({ ticketId: '71273', state, sessionId: 'cc-71273', message: null });

let bridge: FakeBridge;

function renderMenu() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AgentMenu ticketId="71273" extraItems={[{ key: 'assign', label: 'Assign new agent' }]} onExtraSelect={onExtra} />
    </QueryClientProvider>,
  );
}

const onExtra = vi.fn();

describe('AgentMenu (AL-253)', () => {
  beforeEach(() => {
    onExtra.mockReset();
    bridge = installFakeBridge({
      'agent:getStatus': { ok: true, data: status('running') },
      'agent:stop': { ok: true, data: { stopped: true, status: { ...status('stopped'), message: 'You ended this session.' } } },
    });
  });

  it('ends the session after a confirm, and hands other items to their feature', async () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Assign new agent' }));
    expect(onExtra).toHaveBeenCalledWith('assign');

    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'End session' }));
    expect(await screen.findByText('End this session?')).toBeTruthy();
    fireEvent.click(screen.getByTestId('agent-menu-confirm-end'));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('agent:stop', { ticketId: '71273' }));
    await waitFor(() => expect(screen.queryByText('End this session?')).toBeNull());
  });

  it('offers End session only while a session is live', async () => {
    bridge = installFakeBridge({ 'agent:getStatus': { ok: true, data: status('stopped') } });
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    const item = await screen.findByRole('menuitem', { name: 'End session' });
    await waitFor(() => expect(item.getAttribute('aria-disabled')).toBe('true'));
  });
});

describe('permission mode (AL-264)', () => {
  it('shows Follow Settings and the three modes with the current one ticked, and sets a mode', async () => {
    bridge = installFakeBridge({
      'agent:getStatus': { ok: true, data: status('running') },
      'tickets:get': { ok: true, data: { record: { ...fakeTicketRecord({ id: '71273' }), permissionMode: 'ask' } } },
      'settings:get': { ok: true, data: defaultSettings() },
      'agent:setPermissionMode': { ok: true, data: { mode: 'accept-edits', override: true, applied: true } },
    });
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    expect(await screen.findByRole('menuitem', { name: 'Ask, selected' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Follow Settings (Auto)' })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Accept edits' }));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('agent:setPermissionMode', { ticketId: '71273', mode: 'accept-edits' }));

    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: /^Follow Settings/ }));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('agent:setPermissionMode', { ticketId: '71273', mode: null }));
  });
});
