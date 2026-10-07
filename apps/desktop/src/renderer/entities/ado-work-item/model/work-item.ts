import type { WorkItem, WorkItemStateCategory } from '@agent-lanes/contracts';
import type { Tone } from '@agent-lanes/tokens';

/** Short type names the artboards use ("Story · Active"); other types keep ADO's name. */
const shortTypes: Readonly<Record<string, string>> = {
  'User Story': 'Story',
  'Product Backlog Item': 'Backlog item',
};

/** "User Story" → "Story", "Bug" → "Bug". */
export function workItemTypeLabel(type: string): string {
  return shortTypes[type] ?? type;
}

/** "Story · Active" (artboard 2's work item rows). */
export function workItemSummary(item: Pick<WorkItem, 'type' | 'state'>): string {
  return [workItemTypeLabel(item.type), item.state].filter(Boolean).join(' · ');
}

/**
 * The colour of a work item's state, by ADO state category (state names differ per process, D184):
 * in progress is ADO blue, done is green, the rest neutral. The state word always shows beside it.
 */
export function stateCategoryTone(category: WorkItemStateCategory): Tone {
  switch (category) {
    case 'in-progress':
      return 'ado';
    case 'resolved':
    case 'completed':
      return 'ok';
    case 'proposed':
    case 'removed':
    case 'unknown':
      return 'neutral';
  }
}

/** The sprint name from an iteration path: `OnSite Companion\Sprint 42` → `Sprint 42`. */
export function sprintNameOf(iterationPath: string): string {
  return iterationPath.split('\\').filter(Boolean).at(-1) ?? iterationPath;
}
