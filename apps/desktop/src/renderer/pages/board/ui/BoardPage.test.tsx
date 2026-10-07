import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getConnectionsModal, resetConnectionsModal } from '@/shared/model';
import { installFakeBridge } from '@/shared/testing';
import { BoardPage } from './BoardPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BoardPage />
    </QueryClientProvider>,
  );
}

describe('BoardPage', () => {
  it('shows the board title and the runtime from the main process', async () => {
    installFakeBridge({
      'app:getInfo': {
        ok: true,
        data: {
          name: 'Agent Lanes',
          version: '0.1.0',
          platform: 'win32',
          versions: { electron: '44.6.0', chrome: '140.0.0.0', node: '24.9.0' },
        },
      },
    });

    renderPage();

    expect(screen.getByText('Agent board')).toBeTruthy();
    expect(await screen.findByText('v0.1.0 · Electron 44.6.0 · win32')).toBeTruthy();
  });

  it('says so when the main process cannot be reached', async () => {
    installFakeBridge({ 'app:getInfo': { ok: false, code: 'INTERNAL', message: 'down' } });
    renderPage();
    expect(await screen.findByText('Main process unreachable')).toBeTruthy();
  });
});

describe('BoardPage header (AL-046)', () => {
  it('opens Connections from its Connections button', () => {
    resetConnectionsModal();
    installFakeBridge({ 'app:getInfo': { ok: false, code: 'INTERNAL', message: 'not needed here' } });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Connections' }));
    expect(getConnectionsModal()).toMatchObject({ open: true, tab: 'ado', target: null });
    resetConnectionsModal();
  });
});
