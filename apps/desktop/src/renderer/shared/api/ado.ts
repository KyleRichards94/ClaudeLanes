import { focusManager, keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AdoOrgIdSchema, PullRequestRef, Sprint } from '@agent-lanes/contracts';
import type { z } from 'zod';
import type { EventHandlers } from './event-handlers';
import { invoke, unwrap } from './ipc';

/**
 * Azure DevOps server state for the renderer (AL-066, design §6): sprints, work items and pull
 * requests through the `ado:*` channels (AL-065), cached by TanStack Query.
 *
 * Refetch policy: every query refetches when the window comes back into view (refetch on focus, set
 * app-wide). Queries made with `live: true` (the board, while it is open) also poll every 60 s, but
 * never while the window is minimised or hidden: main reports that with `app:window`, which sets
 * TanStack's focus state, and polls only run while it says focused.
 */

/** How often the board's ADO data refreshes while it is open and the window can be seen (design §6). */
export const ADO_REFETCH_INTERVAL_MS = 60_000;

type AdoOrgId = z.infer<typeof AdoOrgIdSchema>;

/** Which organisation and project a query reads; both default in the main process (AL-065). */
export interface AdoScope {
  org?: AdoOrgId;
  project?: string;
}

/** Query keys, from the general to the particular, so `adoKeys.all` invalidates everything ADO. */
export const adoKeys = {
  all: ['ado'] as const,
  sprints: (scope: AdoScope & { team?: string } = {}) => ['ado', 'sprints', scope] as const,
  workItems: (iterationPath: string, scope: AdoScope = {}) => ['ado', 'workItems', iterationPath, scope] as const,
  search: (query: string, scope: AdoScope = {}) => ['ado', 'search', query, scope] as const,
  /** `['ado', 'workItem', id]` (design §6), so a merge can invalidate one work item. */
  workItem: (id: number, org?: AdoOrgId) => (org ? (['ado', 'workItem', id, org] as const) : (['ado', 'workItem', id] as const)),
  pullRequest: (ref: PullRequestRef, org?: AdoOrgId) =>
    ['ado', 'pullRequest', ref.project, ref.repository, ref.pullRequestId, ...(org ? [org] : [])] as const,
};

export interface AdoQueryOptions {
  /** Poll every 60 s while the window can be seen: the board passes true while it is open. */
  live?: boolean;
}

/** The refetch options every ADO query shares. */
function refetchPolicy({ live = false }: AdoQueryOptions) {
  return {
    refetchInterval: live ? ADO_REFETCH_INTERVAL_MS : (false as const),
    // Never poll while the window is minimised or hidden (AL-066).
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  };
}

/** A team's sprints, for the Sprint dropdown (AL-142); `pickSprint` chooses the one to show. */
export function useSprints(scope: AdoScope & { team?: string } = {}, options: AdoQueryOptions = {}) {
  return useQuery({
    queryKey: adoKeys.sprints(scope),
    queryFn: async () => unwrap(await invoke('ado:listSprints', scope)),
    ...refetchPolicy(options),
  });
}

/** The work items in a sprint, for the board and the New agent ticket list (AL-161). Idle until a sprint is chosen. */
export function useWorkItems(sprint: Pick<Sprint, 'path'> | null | undefined, scope: AdoScope = {}, options: AdoQueryOptions = {}) {
  const iterationPath = sprint?.path ?? '';
  return useQuery({
    queryKey: adoKeys.workItems(iterationPath, scope),
    queryFn: async () => unwrap(await invoke('ado:listWorkItems', { ...scope, iterationPath })),
    enabled: iterationPath !== '',
    ...refetchPolicy(options),
  });
}

/**
 * Work items matching an id ("71273", "#71273") or part of a title (AL-161 Search). Idle for a blank
 * query; while a new query loads, the last results stay on screen.
 */
export function useWorkItemSearch(query: string, scope: AdoScope = {}) {
  const trimmed = query.trim();
  return useQuery({
    queryKey: adoKeys.search(trimmed, scope),
    queryFn: async () => unwrap(await invoke('ado:searchWorkItems', { ...scope, query: trimmed })),
    enabled: trimmed !== '',
    placeholderData: keepPreviousData,
    ...refetchPolicy({}),
  });
}

/** One work item, for the drill-in and the ADO tab (AL-170, AL-180). Idle without an id. */
export function useWorkItem(id: number | null | undefined, org?: AdoOrgId, options: AdoQueryOptions = {}) {
  return useQuery({
    queryKey: adoKeys.workItem(id ?? 0, org),
    queryFn: async () => unwrap(await invoke('ado:getWorkItem', { id: id ?? 0, ...(org ? { org } : {}) })),
    enabled: typeof id === 'number' && id > 0,
    ...refetchPolicy(options),
  });
}

/** A pull request and its checks, for "PR !10612 · 3 / 4 checks" (AL-144, AL-181). Idle without a ref. */
export function usePullRequest(ref: PullRequestRef | null | undefined, org?: AdoOrgId, options: AdoQueryOptions = {}) {
  return useQuery({
    queryKey: ref ? adoKeys.pullRequest(ref, org) : (['ado', 'pullRequest', null] as const),
    queryFn: async () => {
      if (!ref) throw new Error('No pull request to read');
      return unwrap(await invoke('ado:getPullRequest', { ...ref, ...(org ? { org } : {}) }));
    },
    enabled: Boolean(ref),
    ...refetchPolicy(options),
  });
}

/**
 * `app:window` → TanStack's focus state: a minimised or hidden window is "not focused", so polls stop;
 * coming back hands focus back to the page's own visibility, which refetches what is stale.
 */
export const windowVisibilityEventHandlers: EventHandlers = {
  'app:window': ({ visible }) => {
    focusManager.setFocused(visible ? undefined : false);
  },
};
