import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import {
  agentUsageEventHandlers,
  connectionsEventHandlers,
  createBranchStatusEventHandlers,
  createDesignSpecEventHandlers,
  designThreadEventHandlers,
  mcpStatusEventHandlers,
  planLimitsEventHandlers,
} from '@/shared/api';
import { subAgentEventHandlers } from '@/entities/sub-agent';
import { permissionEventHandlers } from '@/features/resolve-permission';
import { sessionStatusEventHandlers } from '@/features/start-queued-agent';
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
  // `agent:usage` keeps each ticket's session pill and Lead agent tokens current (AL-113).
  useEffect(() => runningEventHub()?.register(agentUsageEventHandlers(queryClient)), [queryClient]);
  // `design:spec` reads the ticket record again: shipped specs, "Used · 14:01" (AL-198).
  useEffect(() => runningEventHub()?.register(createDesignSpecEventHandlers(queryClient)), [queryClient]);
  // `agent:mcpStatus` keeps the header's MCP pill current (AL-108).
  useEffect(() => runningEventHub()?.register(mcpStatusEventHandlers(queryClient)), [queryClient]);
  // `agent:planLimits` keeps the plan-limits meter current (AL-258).
  useEffect(() => runningEventHub()?.register(planLimitsEventHandlers(queryClient)), [queryClient]);
  // `agent:permission` keeps each ticket's waiting permission request current (AL-109).
  useEffect(() => runningEventHub()?.register(permissionEventHandlers(queryClient)), [queryClient]);
  // `agent:subagent` → the ticket's cached sub-agent tree (AL-177).
  useEffect(() => runningEventHub()?.register(subAgentEventHandlers(queryClient)), [queryClient]);
  // `design:thread` → the ticket's cached design thread (AL-196).
  useEffect(() => runningEventHub()?.register(designThreadEventHandlers(queryClient)), [queryClient]);
  // `agent:status` keeps each ticket's session status current, e.g. Queued and Start now (AL-111).
  useEffect(() => runningEventHub()?.register(sessionStatusEventHandlers(queryClient)), [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router}>
        <UiPrefsGate>{children}</UiPrefsGate>
      </RouterProvider>
    </QueryClientProvider>
  );
}
