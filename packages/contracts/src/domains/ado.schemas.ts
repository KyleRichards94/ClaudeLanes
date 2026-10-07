import { z } from 'zod';
import type { InvokeContract } from '../contract';
import type { ADO_EVENT_CHANNELS, ADO_INVOKE_CHANNELS } from './ado.names';

/**
 * ADO's state categories (`Proposed`, `InProgress`, `Resolved`, `Completed`, `Removed`), kebab-cased
 * like the rest of the vocabulary. The UI colours a work item's state by category, because state
 * names differ per process ("Active", "Committed" and "Doing" are all in progress). `unknown` when
 * ADO could not say (AL-062).
 */
export const WORK_ITEM_STATE_CATEGORIES = ['proposed', 'in-progress', 'resolved', 'completed', 'removed', 'unknown'] as const;
export const WorkItemStateCategorySchema = z.enum(WORK_ITEM_STATE_CATEGORIES);
export type WorkItemStateCategory = z.infer<typeof WorkItemStateCategorySchema>;

/** ADO work item ids are positive 32-bit integers. */
export const WORK_ITEM_ID_MAX = 2_147_483_647;
export const WorkItemIdSchema = z.int().min(1).max(WORK_ITEM_ID_MAX);
export type WorkItemId = z.infer<typeof WorkItemIdSchema>;

export const WorkItemAssigneeSchema = z.object({
  displayName: z.string(),
  /** Sign-in name (usually an email); null when ADO gave only a display name. */
  uniqueName: z.string().nullable(),
});
export type WorkItemAssignee = z.infer<typeof WorkItemAssigneeSchema>;

/**
 * One Azure DevOps work item as the app shows it (artboards 2 and 3, R6): "#71273 · Cutover
 * frmJobControl to Blazor · Story · Active", its sprint and assignee, and "Open in Azure DevOps ↗".
 * Built by `@agent-lanes/ado-client` (AL-062); AL-065 sends it over IPC.
 */
export const WorkItemSchema = z.object({
  id: WorkItemIdSchema,
  /** `System.TeamProject`; the comments and pull request APIs are project-scoped. */
  project: z.string().min(1),
  /** `System.WorkItemType` as ADO names it ("User Story", "Bug", "Task", "Product Backlog Item"). */
  type: z.string().min(1),
  title: z.string(),
  /** `System.State` as ADO names it ("Active", "New", "Closed"). */
  state: z.string(),
  stateCategory: WorkItemStateCategorySchema,
  assignedTo: WorkItemAssigneeSchema.nullable(),
  /** `System.IterationPath`, e.g. `OnSite Companion\Sprint 42`; its last segment is the sprint name. */
  iterationPath: z.string(),
  /** `System.Description` as ADO stores it (HTML); null when empty. */
  description: z.string().nullable(),
  /** `Microsoft.VSTS.Common.AcceptanceCriteria` (HTML); null when empty or the type has none. */
  acceptanceCriteria: z.string().nullable(),
  /** The item in the ADO web UI, for "Open in Azure DevOps ↗". Only http(s), so it is safe to open externally. */
  webUrl: z.url({ protocol: /^https?$/ }),
});
export type WorkItem = z.infer<typeof WorkItemSchema>;

export const adoInvokeContracts = {} as const satisfies Record<(typeof ADO_INVOKE_CHANNELS)[number], InvokeContract>;

export const adoEventContracts = {} as const satisfies Record<(typeof ADO_EVENT_CHANNELS)[number], z.ZodType>;
