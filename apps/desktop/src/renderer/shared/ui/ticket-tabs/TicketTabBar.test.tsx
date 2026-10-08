import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DesignThread } from '@agent-lanes/contracts';
import { designThreadEventHandlers, subscribe } from '@/shared/api';
import { resetDesignThreadSeen, type TicketTab } from '@/shared/model';
import { RouterProvider, createRouter, routes } from '@/shared/routing';
import { installFakeBridge } from '@/shared/testing';
import { TicketTabBar } from './TicketTabBar';

const thread = (messages: DesignThread['messages']): DesignThread => ({ ticketId: '71273', status: 'idle', reason: null, messages, approval: null });

function renderBar(value: TicketTab, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const router = createRouter(routes.ticket('71273'));
  const view = (tab: TicketTab) => (
    <QueryClientProvider client={client}>
      <RouterProvider router={router}>
        <TicketTabBar ticketId="71273" value={tab} />
      </RouterProvider>
    </QueryClientProvider>
  );
  const result = render(view(value));
  return { client, rerender: (tab: TicketTab) => result.rerender(view(tab)) };
}

describe('TicketTabBar: unread design replies (AL-200)', () => {
  beforeEach(() => resetDesignThreadSeen(1_000));

  it('badges Claude Design with the design replies that came in since the user last looked', async () => {
    installFakeBridge({
      'design:getThread': {
        ok: true,
        data: thread([
          { id: 'old', role: 'design', text: 'An older reply', at: 500 },
          { id: 'u1', role: 'user', text: 'Tighten the grid', at: 1_200 },
          { id: 'd1', role: 'design', text: 'Done: 8 px gaps', at: 1_300 },
          { id: 'd2', role: 'design', text: 'Also fixed the header', at: 1_400 },
        ]),
      },
    });
    const { rerender } = renderBar('output');
    expect(await screen.findByRole('tab', { name: 'Claude Design, 2 unread replies' })).toBeTruthy();

    // Opening the design tab reads them.
    rerender('design');
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Claude Design' })).toBeTruthy());
    rerender('output');
    expect(screen.getByRole('tab', { name: 'Claude Design' })).toBeTruthy();
  });

  it('follows design:thread events and shows no badge without unread replies', async () => {
    const bridge = installFakeBridge({ 'design:getThread': { ok: true, data: thread([]) } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const off = subscribe('design:thread', designThreadEventHandlers(client)['design:thread']!);
    renderBar('output', client);
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('design:getThread', { ticketId: '71273' }));
    expect(screen.getByRole('tab', { name: 'Claude Design' })).toBeTruthy();

    act(() => bridge.emit('design:thread', { ticketId: '71273', at: 2_000, thread: thread([{ id: 'd1', role: 'design', text: 'Reply', at: 2_000 }]) }));
    expect(await screen.findByRole('tab', { name: 'Claude Design, 1 unread reply' })).toBeTruthy();
    off();
  });
});
