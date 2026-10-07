import { z } from 'zod';

/**
 * Work item ids, in a file of their own so `ado.pull-requests.ts` and `ado.write-back.ts` can share
 * them (D219) while `ado.schemas.ts` imports both for the `ado:*` channel contracts (AL-065) without
 * an import cycle. `ado.schemas.ts` re-exports them.
 */

/** ADO work item ids are positive 32-bit integers. */
export const WORK_ITEM_ID_MAX = 2_147_483_647;
export const WorkItemIdSchema = z.int().min(1).max(WORK_ITEM_ID_MAX);
export type WorkItemId = z.infer<typeof WorkItemIdSchema>;
