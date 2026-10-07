import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { RouterProvider } from '@/shared/routing';
import { connectRouterToWindow, createAppRouter } from '../routing';

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

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router}>{children}</RouterProvider>
    </QueryClientProvider>
  );
}
