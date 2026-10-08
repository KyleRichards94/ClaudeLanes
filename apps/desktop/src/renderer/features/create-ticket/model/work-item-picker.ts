import type { WorkItem } from '@agent-lanes/contracts';
import { useEffect, useState } from 'react';
import type { PickedWorkItem } from './form';

/** How long the Search box waits after the last key before it asks Azure DevOps (AL-161). */
export const WORK_ITEM_SEARCH_DEBOUNCE_MS = 300;

/** `value`, once it has stopped changing for `delayMs`. */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return settled;
}

/**
 * The sprint's items that match what is typed in "Search by ID or title": an id ("71273",
 * "#7127") matches from the start of the id, any other text anywhere in the title, ignoring case.
 */
export function filterWorkItems(items: readonly WorkItem[], query: string): readonly WorkItem[] {
  const text = query.trim().toLowerCase();
  if (!text) return items;
  const id = /^#?(\d+)$/.exec(text)?.[1];
  return items.filter((item) => (id ? String(item.id).startsWith(id) : item.title.toLowerCase().includes(text)));
}

/** The form's copy of a picked row. */
export function pickedWorkItem(item: Pick<WorkItem, 'id' | 'title' | 'type' | 'state'>): PickedWorkItem {
  return { id: item.id, title: item.title, type: item.type, state: item.state };
}
