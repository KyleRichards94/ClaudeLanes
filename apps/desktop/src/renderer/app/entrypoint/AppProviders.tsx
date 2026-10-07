import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { connectionsEventHandlers, createBranchStatusEventHandlers } from '@/shared/api';
import { RouterProvider } from '@/shared/routing';
import { connectRouterToWindow, createAppRouter } from '../routing';
import { runningEventHub } from './EventHub';
import { UiPrefsGate } from './UiPrefsGate';

const SIXTY_SECONDS = 60_000;

/** Server state defaults from design §6: refetch on focus, and every 60 s while the board is open. */
function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: true,
        staleTime: SIXTY_SECONDS,
        retry: 1,
      },
    },
  });
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const [router] = useState(() => createAppRouter());
  useEffect(() => connectRouterToWindow(router), [router]);
  // Events that make server state stale, e.g. a sub-agent's commits → its ticket's branch status (AL-085).
  useEffect(() => runningEventHub()?.register(createBranchStatusEventHandlers(queryClient)), [queryClient]);
  // `connections:changed` refetches the connection list and ADO queries (AL-046, AL-066).
  useEffect(() => runningEventHub()?.register(connectionsEventHandlers(queryClient)), [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router}>
        <UiPrefsGate>{children}</UiPrefsGate>
      </RouterProvider>
    </QueryClientProvider>
  );
}
