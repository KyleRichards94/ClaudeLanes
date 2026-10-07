import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  InvokeRequest,
  ConnectionId,
  ConnectionSummary,
  ConnectionTestResult,
  RemoveConnectionResult,
} from '@agent-lanes/contracts';
import type { EventHandlers } from './event-handlers';
import { invoke, unwrap } from './ipc';

export const connectionsQueryKey = ['connections'] as const;
export const claudeLoginQueryKey = ['connections', 'claude-login'] as const;

/** A draft as the renderer sends it (the main process trims and checks it). Carries a token: requests only. */
export type ConnectionDraftInput = InvokeRequest<'connections:save'>;

/**
 * Saved connections for the Connections modal (AL-046) and the first-run gate (AL-047): status and
 * identity only, never a token (design §8). Refetched when main emits `connections:changed`.
 */
export function useConnections() {
  return useQuery({
    queryKey: connectionsQueryKey,
    queryFn: async () => unwrap(await invoke('connections:list')),
    // Changes arrive through `connections:changed` (connectionsEventHandlers) and the mutations below.
    staleTime: Infinity,
  });
}

/** Puts a saved or replaced row into the cached list, in place or at the end. */
function storeRow(queryClient: QueryClient, row: ConnectionSummary): void {
  queryClient.setQueryData<ConnectionSummary[]>(connectionsQueryKey, (rows) => {
    if (!rows) return rows;
    const index = rows.findIndex((existing) => existing.id === row.id);
    return index === -1 ? [...rows, row] : rows.with(index, row);
  });
  void queryClient.invalidateQueries({ queryKey: connectionsQueryKey });
}

/** Tests a draft (the token goes to main and no further) or a saved connection by id. */
export function useTestConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: InvokeRequest<'connections:test'>): Promise<ConnectionTestResult> =>
      unwrap(await invoke('connections:test', request)),
    onSuccess: (_result, request) => {
      // Re-testing a saved row changes its status.
      if ('id' in request) void queryClient.invalidateQueries({ queryKey: connectionsQueryKey });
    },
  });
}

/** Saves a tested draft. The token goes straight into the main process's secret store. */
export function useSaveConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (draft: ConnectionDraftInput): Promise<ConnectionSummary> => unwrap(await invoke('connections:save', draft)),
    onSuccess: (row) => storeRow(queryClient, row),
  });
}

/** Replaces a saved connection's token and settings, keeping its id. */
export function useReplaceConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (request: InvokeRequest<'connections:replace'>): Promise<ConnectionSummary> =>
      unwrap(await invoke('connections:replace', request)),
    onSuccess: (row) => storeRow(queryClient, row),
  });
}

/** Removes a connection and deletes its token. */
export function useRemoveConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: ConnectionId): Promise<RemoveConnectionResult> => unwrap(await invoke('connections:remove', { id })),
    onSuccess: ({ id }) => {
      queryClient.setQueryData<ConnectionSummary[]>(connectionsQueryKey, (rows) => rows?.filter((row) => row.id !== id && !(row.kind === 'mcp' && row.builtInFor === id)));
      void queryClient.invalidateQueries({ queryKey: connectionsQueryKey });
    },
  });
}

/**
 * Looks for a Claude Code login on this computer (AL-044). Starts Claude Code without sending a
 * prompt, so it only runs when `enabled` (the Claude tab is open and nothing is saved yet).
 */
export function useClaudeLoginDetection(enabled: boolean) {
  return useQuery({
    queryKey: claudeLoginQueryKey,
    queryFn: async () => unwrap(await invoke('connections:detectClaude')),
    enabled,
    staleTime: Infinity,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** `connections:changed` → refetch the list. The app registers this with its event hub. */
export function connectionsEventHandlers(queryClient: QueryClient): EventHandlers {
  return {
    'connections:changed': () => {
      void queryClient.invalidateQueries({ queryKey: connectionsQueryKey, exact: true });
    },
  };
}
