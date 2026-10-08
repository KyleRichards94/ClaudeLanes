import { adoFixture } from '@agent-lanes/contracts/testing';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { tone } from '@agent-lanes/tokens';
import { createAgentTicketStore } from '@/entities/agent-ticket';
import { fakeAdoRow, fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { BoardTicketCard } from './BoardTicketCard';

function rgb(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

const CONTOSO = fakeAdoRow({ id: 'ado:contoso', name: 'contoso', orgUrl: 'https://dev.azure.com/contoso' });

function renderCard(replies: Parameters<typeof installFakeBridge>[0]) {
  const bridge = installFakeBridge({ 'connections:list': { ok: true, data: [CONTOSO] }, ...replies });
  const store = createAgentTicketStore();
  store.load([fakeTicketRecord({ id: '71273', stage: 'implementing' })]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BoardTicketCard ticketId="71273" store={store} testID="card" />
    </QueryClientProvider>,
  );
  return bridge;
}

describe('BoardTicketCard', () => {
  it("shows the work item's ADO state with ADO's type and state colours, read through the ticket's organisation", async () => {
    const workItem = { ...adoFixture().workItems.find((item) => item.id === 71273)!, type: 'User Story', state: 'Active' };
    const bridge = renderCard({
      'ado:getWorkItem': { ok: true, data: workItem },
      'ado:workItemColors': { ok: true, data: { types: { 'User Story': '#009CCC' }, states: { 'User Story': { Active: '#007ACC' } } } },
    });

    await waitFor(() => expect(screen.getByTestId('card-state').textContent).toBe('Active'));
    await waitFor(() => expect(getComputedStyle(screen.getByTestId('card-type')).backgroundColor).toBe(rgb('#009CCC')));
    expect(getComputedStyle(screen.getByTestId('card-state-dot')).backgroundColor).toBe(rgb('#007ACC'));
    expect(bridge.invoke).toHaveBeenCalledWith('ado:getWorkItem', { id: 71273, org: 'ado:contoso' });
    expect(bridge.invoke).toHaveBeenCalledWith('ado:workItemColors', { org: 'ado:contoso', project: 'OnSite Companion' });
  });

  it('keeps the token colours and leaves the state out when ADO cannot be read', async () => {
    renderCard({});
    await screen.findByTestId('card');
    expect(getComputedStyle(screen.getByTestId('card-type')).backgroundColor).toBe(rgb(tone.ado.dot));
    expect(screen.queryByTestId('card-state')).toBeNull();
  });
});
