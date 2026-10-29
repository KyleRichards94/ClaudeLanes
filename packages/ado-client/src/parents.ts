import { err, ok, WorkItemIdSchema, type Result } from '@agent-lanes/contracts';
import { z } from 'zod';
import type { AdoClient } from './client';
import { isAdoErrorDetails } from './errors';
import { adoPath } from './path';

/** Links followed up from a work item before giving up on finding a Feature or Epic. */
export const MAX_PARENT_HOPS = 5;
export const ROOM_PARENT_TYPES = ['Feature', 'Epic'] as const;

export interface PortfolioParent {
  id: number;
  type: string;
  title: string;
}

const parentFieldsSchema = z.object({
  id: WorkItemIdSchema,
  fields: z
    .object({
      'System.Parent': z.number().nullish(),
      'System.WorkItemType': z.string().optional(),
      'System.Title': z.string().optional(),
    })
    .loose(),
});

export interface NearestParentOptions {
  id: number;
  /** Work item types that end the walk; Feature and Epic by default (P2). */
  types?: readonly string[];
  signal?: AbortSignal;
}

/**
 * The nearest Feature or Epic above a work item (peer lanes, P2): its parent, grandparent, … read
 * through `System.Parent`, which Azure DevOps Server 2020 and later return like the hosted service.
 * Null when the chain ends, can't be read, or is longer than {@link MAX_PARENT_HOPS}.
 */
export async function nearestPortfolioParent(client: AdoClient, options: NearestParentOptions): Promise<Result<PortfolioParent | null>> {
  const types = new Set((options.types ?? ROOM_PARENT_TYPES).map((type) => type.toLowerCase()));
  const read = (id: number) =>
    client.get(adoPath`/_apis/wit/workitems/${id}`, parentFieldsSchema, {
      query: { fields: ['System.Parent', 'System.WorkItemType', 'System.Title'] },
      signal: options.signal,
    });
  const start = await read(options.id);
  if (!start.ok) return start;
  let parentId = start.data.fields['System.Parent'] ?? null;
  for (let hop = 0; hop < MAX_PARENT_HOPS && parentId; hop += 1) {
    const parent = await read(parentId);
    if (!parent.ok) {
      // A parent this token can't read is no room, not a failure to retry.
      return isAdoErrorDetails(parent.details) && parent.details.status === 404 ? ok(null) : parent;
    }
    const type = parent.data.fields['System.WorkItemType'] ?? '';
    if (types.has(type.toLowerCase())) return ok({ id: parent.data.id, type, title: parent.data.fields['System.Title'] ?? '' });
    parentId = parent.data.fields['System.Parent'] ?? null;
  }
  return parentId ? err('VALIDATION', `No Feature or Epic within ${MAX_PARENT_HOPS} links above #${options.id}.`) : ok(null);
}
