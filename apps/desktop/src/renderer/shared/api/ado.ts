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
  /** The user's teams in a project (`ado:listTeams`), for the board's Team menu. */
  teams: (scope: AdoScope = {}) => ['ado', 'teams', scope] as const,
  /** The project's work item type and state colours (`ado:workItemColors`). */
  workItemColors: (scope: AdoScope = {}) => ['ado', 'workItemColors', scope] as const,
  sprints: (scope: AdoScope & { team?: string } = {}) => ['ado', 'sprints', scope] as const,
  workItems: (iterationPath: string, scope: AdoScope = {}) => ['ado', 'workItems', iterationPath, scope] as const,
  search: (query: string, scope: AdoScope = {}) => ['ado', 'search', query, scope] as const,
  /** `['ado', 'workItem', id]` (design §6), so a merge can invalidate one work item. */
  workItem: (id: number, org?: AdoOrgId) => (org ? (['ado', 'workItem', id, org] as const) : (['ado', 'workItem', id] as const)),
  /** Under the work item's key, so invalidating a work item refreshes its discussion too (AL-180). */
  comments: (id: number, project: string) => ['ado', 'workItem', id, 'comments', project] as const,
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

/**
 * The user's teams in the project and the one ADO opens on (`defaultTeamId`), for the board's Team
 * menu; `useBoardTeam` (shared/model) picks the one the board shows.
 */
export function useTeams(scope: AdoScope = {}, options: AdoQueryOptions = {}) {
  return useQuery({
    queryKey: adoKeys.teams(scope),
    queryFn: async () => unwrap(await invoke('ado:listTeams', scope)),
    ...refetchPolicy(options),
  });
}

/** How long the work item colours stay fresh in the renderer: they change only when someone edits the process. */
export const WORK_ITEM_COLORS_STALE_MS = 30 * 60_000;

/**
 * The project's work item type and state colours, as ADO's boards show them, for the cards' type bar
 * and state dot. Long-lived: no polling and no refetch on focus; while it loads or fails, cards use
 * the token colours.
 */
export function useWorkItemColors(scope: AdoScope = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: adoKeys.workItemColors(scope),
    queryFn: async () => unwrap(await invoke('ado:workItemColors', scope)),
    enabled: options.enabled ?? true,
    staleTime: WORK_ITEM_COLORS_STALE_MS,
    gcTime: WORK_ITEM_COLORS_STALE_MS,
    refetchOnWindowFocus: false,
  });
}

/**
 * A team's sprints, for the Sprint dropdown (AL-142); `pickSprint` chooses the one to show. Pass the
 * board's team (`useBoardSprints` in shared/model does); without one, main resolves the user's
 * default team. `enabled: false` holds the query, e.g. while the team is still loading.
 */
export function useSprints(scope: AdoScope & { team?: string } = {}, options: AdoQueryOptions & { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: adoKeys.sprints(scope),
    queryFn: async () => unwrap(await invoke('ado:listSprints', scope)),
    enabled: options.enabled ?? true,
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

/** A work item's discussion, oldest first, for the ADO tab (AL-180). Idle without an id. */
export function useWorkItemComments(id: number | null | undefined, project: string, options: AdoQueryOptions = {}) {
  return useQuery({
    queryKey: adoKeys.comments(id ?? 0, project),
    queryFn: async () => unwrap(await invoke('ado:getComments', { workItemId: id ?? 0, project })),
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
