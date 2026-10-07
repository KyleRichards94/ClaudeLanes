import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeBridge } from '@/shared/testing';

// The first test pays the cold transform of every page and the UI package; under the full parallel
// suite that can take longer than Vitest's 5 s default.
vi.setConfig({ testTimeout: 30_000 });

const appInfo = {
  ok: true,
  data: {
    name: 'Agent Lanes',
    version: '0.1.0',
    platform: 'win32',
    versions: { electron: '44.6.0', chrome: '140.0.0.0', node: '24.9.0' },
  },
};

/**
 * Each test loads the router and the pages afresh, so every page starts out unloaded, as it is when
 * the app opens; otherwise a page loaded by an earlier test would render without suspending.
 */
async function renderFreshRouter() {
  vi.resetModules();
  const [{ AppRouter }, routing] = await Promise.all([import('./AppRouter'), import('@/shared/routing')]);
  const router = routing.createRouter();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <routing.RouterProvider router={router}>
        <AppRouter />
      </routing.RouterProvider>
    </QueryClientProvider>,
  );
  return { router, routes: routing.routes };
}

describe('AppRouter', () => {
  beforeEach(() => {
    installFakeBridge({ 'app:getInfo': appInfo });
  });

  it('loads the first page lazily behind Suspense', async () => {
    await renderFreshRouter();

    expect(screen.getByTestId('page-loading')).toBeTruthy();
    expect(await screen.findByText('Agent board')).toBeTruthy();
    expect(screen.queryByTestId('page-loading')).toBeNull();
  });

  it('shows the page for each route, with its ticket id', async () => {
    const { router, routes } = await renderFreshRouter();
    await screen.findByText('Agent board');

    act(() => router.navigate(routes.ticket('71273')));
    expect(await screen.findByTestId('ticket-page')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '#71273' })).toBeTruthy();

    act(() => router.navigate(routes.ticketDesign('71273')));
    expect(await screen.findByTestId('design-tab-page')).toBeTruthy();
    expect(screen.getByText('#71273')).toBeTruthy();

    act(() => router.navigate(routes.ticket('80001')));
    expect(await screen.findByRole('heading', { name: '#80001' })).toBeTruthy();
  });

  it('keeps the current page on screen while the next page loads', async () => {
    const { router, routes } = await renderFreshRouter();
    await screen.findByText('Agent board');

    act(() => router.navigate(routes.ticketDesign('71273')));
    // The design tab's chunk is still loading: the board stays, no blank fallback.
    expect(screen.getByText('Agent board')).toBeTruthy();
    expect(screen.queryByTestId('page-loading')).toBeNull();

    expect(await screen.findByTestId('design-tab-page')).toBeTruthy();
    expect(screen.queryByText('Agent board')).toBeNull();
  });
});
