import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import type { McpStatusSummary } from '@agent-lanes/contracts';
import { mcpStatusEventHandlers, subscribe } from '@/shared/api';
import { installFakeBridge } from '@/shared/testing';
import { McpStatusPill, mcpPillView } from './McpStatusPill';

const online: McpStatusSummary = {
  state: 'online',
  servers: [
    { name: 'agent_lanes', state: 'connected', error: null, ticketIds: ['71273'] },
    { name: 'azure-devops', state: 'connected', error: null, ticketIds: ['71273'] },
  ],
};

/** Routes `agent:mcpStatus` into the query cache the way the app's event hub does. */
function EventRoute({ client }: { client: QueryClient }) {
  useEffect(() => {
    const handle = mcpStatusEventHandlers(client)['agent:mcpStatus']!;
    return subscribe('agent:mcpStatus', handle);
  }, [client]);
  return null;
}

function renderPill() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <EventRoute client={client} />
      <McpStatusPill />
    </QueryClientProvider>,
  );
}

describe('MCP status pill (AL-108, artboard 1)', () => {
  it('reads "MCP online" in green while every server is connected', async () => {
    installFakeBridge({ 'agent:getMcpStatus': { ok: true, data: online } });
    renderPill();
    expect(await screen.findByText('MCP online')).toBeTruthy();
    expect(screen.getByTestId('mcp-status-pill-dot')).toBeTruthy();
  });

  it('turns amber with the failing server name on hover when a server fails', async () => {
    const bridge = installFakeBridge({ 'agent:getMcpStatus': { ok: true, data: online } });
    renderPill();
    await screen.findByText('MCP online');

    act(() =>
      bridge.emit('agent:mcpStatus', {
        at: 1,
        state: 'failing',
        servers: [{ name: 'azure-devops', state: 'failed', error: 'spawn npx ENOENT', ticketIds: ['71273'] }, online.servers[0]],
      }),
    );

    const label = await screen.findByText('1 MCP failing');
    // The hover tooltip (the wrapper's title on web) names the server and why.
    expect(label.closest('[title]')?.getAttribute('title')).toBe('Failing: azure-devops (spawn npx ENOENT)');
  });

  it('says MCP idle when no session runs', async () => {
    installFakeBridge({ 'agent:getMcpStatus': { ok: true, data: { state: 'none', servers: [] } } });
    renderPill();
    expect(await screen.findByText('MCP idle')).toBeTruthy();
  });

  it('counts needs-auth servers as failing', () => {
    expect(mcpPillView({ state: 'failing', servers: [{ name: 'github', state: 'needs-auth', error: null, ticketIds: ['71273'] }] })).toEqual({
      label: '1 MCP failing',
      tone: 'attention',
      hint: 'Failing: github',
    });
  });
});
