import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { agentTickets } from '@/entities/agent-ticket';
import { RouterProvider, createRouter } from '@/shared/routing';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { BoardPage } from './BoardPage';

const appInfo = {
  ok: true,
  data: {
    name: 'Agent Lanes',
    version: '0.1.0',
    platform: 'win32',
    versions: { electron: '44.6.0', chrome: '140.0.0.0', node: '24.9.0' },
  },
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={createRouter()}>
        <BoardPage />
      </RouterProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => agentTickets.load([]));

describe('BoardPage', () => {
  it('shows the board title and the runtime from the main process', async () => {
    installFakeBridge({ 'app:getInfo': appInfo, 'tickets:list': { ok: true, data: [] } });

    renderPage();

    expect(screen.getByText('Agent board')).toBeTruthy();
    expect(await screen.findByText('v0.1.0 · Electron 44.6.0 · win32')).toBeTruthy();
  });

  it('says so when the main process cannot be reached', async () => {
    installFakeBridge({ 'app:getInfo': { ok: false, code: 'INTERNAL', message: 'down' } });
    renderPage();
    expect(await screen.findByText('Main process unreachable')).toBeTruthy();
  });

  it('loads the ticket records into the lanes', async () => {
    installFakeBridge({
      'app:getInfo': appInfo,
      'tickets:list': { ok: true, data: [fakeTicketRecord({ id: '71273', stage: 'implementing' }), fakeTicketRecord({ id: '71330', stage: 'queued' })] },
    });
    renderPage();

    expect(await within(screen.getByTestId('lane-implementing')).findByRole('button', { name: /^#71273/ })).toBeTruthy();
    expect(within(screen.getByTestId('lane-queued')).getByRole('button', { name: /^#71330/ })).toBeTruthy();
  });
});
