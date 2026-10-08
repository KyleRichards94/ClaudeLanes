import type { BacklogKind } from '@agent-lanes/contracts';
import { create } from 'zustand';

/** All / Story / Bug / Task (artboard 11). */
export type BacklogKindFilter = 'all' | BacklogKind;

/** The popout's search and filters, as the user set them. */
export interface BacklogSearch {
  /** The search box: an id, or part of a title or tag. */
  readonly text: string;
  readonly kind: BacklogKindFilter;
  /** 1–4, or null for any. */
  readonly priority: number | null;
  /** An area path, or null for all. */
  readonly area: string | null;
  /** A tag, or null for any. */
  readonly tag: string | null;
  /** Also show items already in a sprint. */
  readonly includeInSprint: boolean;
}

export const DEFAULT_BACKLOG_SEARCH: BacklogSearch = { text: '', kind: 'all', priority: null, area: null, tag: null, includeInSprint: false };

/**
 * Search and filters are remembered for the session (TB§5): in memory only, so closing and reopening
 * the popout keeps them, and a restart starts from no filters.
 */
const useSearch = create<BacklogSearch>()(() => DEFAULT_BACKLOG_SEARCH);

export function useBacklogSearch(): BacklogSearch {
  return useSearch();
}

export function setBacklogSearch(change: Partial<BacklogSearch>): void {
  useSearch.setState(change);
}

/** Back to no filters (tests). */
export function resetBacklogSearch(): void {
  useSearch.setState(DEFAULT_BACKLOG_SEARCH, true);
}
