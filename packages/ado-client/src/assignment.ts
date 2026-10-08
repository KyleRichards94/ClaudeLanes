import { err, ok, type Result } from '@agent-lanes/contracts';
import { z } from 'zod';
import type { AdoCallOptions, AdoClient } from './client';
import { isAdoErrorDetails } from './errors';
import { adoPath } from './path';
import { CONNECTION_DATA_API_VERSION } from './connection-test';
import { toStateCategory } from './work-item-states';

/**
 * Assign to me and move to In Progress (AL-236, T5): the one Azure DevOps change a team board drop
 * makes, and putting it back when the launch fails or is undone (AL-237). Every write is one JSON Patch
 * guarded by a `test` of the revision just read, so a change someone else made in between is never
 * overwritten.
 */

export type AssignmentCallOptions = Pick<AdoCallOptions, 'signal' | 'timeoutMs'>;

/** Someone a work item can be assigned to. */
export interface AdoPerson {
  id: string | null;
  displayName: string;
  /** Sign-in name (usually an email); what a JSON Patch to `System.AssignedTo` takes. */
  uniqueName: string | null;
}

/** The fields an assignment change reads and writes. */
export interface WorkItemAssignment {
  workItemId: number;
  rev: number;
  type: string;
  state: string;
  assignee: AdoPerson | null;
}

/** A work item and its project. */
export interface AssignmentRef {
  project: string;
  workItemId: number;
}

const personSchema = z.object({ id: z.string().nullish(), displayName: z.string(), uniqueName: z.string().nullish() });

const assignmentSchema = z.object({
  id: z.int().min(1),
  rev: z.int().min(1),
  fields: z.object({
    'System.State': z.string().min(1),
    'System.WorkItemType': z.string().min(1).optional(),
    'System.AssignedTo': z.union([personSchema, z.string()]).nullish(),
  }),
});

const ASSIGNMENT_FIELDS = 'System.State,System.WorkItemType,System.AssignedTo';

function toAssignment(raw: z.infer<typeof assignmentSchema>, type?: string): WorkItemAssignment {
  const assigned = raw.fields['System.AssignedTo'];
  let assignee: AdoPerson | null = null;
  if (typeof assigned === 'string') {
    const match = /^(.*?)\s*<([^<>]+)>$/.exec(assigned);
    assignee = { id: null, displayName: match ? match[1]! : assigned, uniqueName: match ? match[2]! : null };
  } else if (assigned) {
    assignee = { id: assigned.id ?? null, displayName: assigned.displayName, uniqueName: assigned.uniqueName ?? null };
  }
  return { workItemId: raw.id, rev: raw.rev, type: raw.fields['System.WorkItemType'] ?? type ?? '', state: raw.fields['System.State'], assignee };
}

/** The work item's state, type, assignee and revision, read fresh. Never throws. */
export async function getWorkItemAssignment(client: AdoClient, ref: AssignmentRef, options: AssignmentCallOptions = {}): Promise<Result<WorkItemAssignment>> {
  const read = await client.get(adoPath`/${ref.project}/_apis/wit/workitems/${ref.workItemId}`, assignmentSchema, { ...options, query: { fields: ASSIGNMENT_FIELDS } });
  return read.ok ? ok(toAssignment(read.data)) : read;
}

const connectionDataSchema = z.object({
  authenticatedUser: z.object({
    id: z.string().min(1),
    providerDisplayName: z.string().nullish(),
    customDisplayName: z.string().nullish(),
    properties: z.object({ Account: z.object({ $value: z.string().nullish() }).loose().nullish() }).loose().nullish(),
  }),
});

/** Who the token signs in as, with the sign-in name an assignment needs (`_apis/connectionData`, TB§6 Identity). */
export async function getSignedInUser(client: AdoClient, options: AssignmentCallOptions = {}): Promise<Result<AdoPerson & { id: string }>> {
  const answer = await client.get('/_apis/connectionData', connectionDataSchema, { ...options, apiVersion: CONNECTION_DATA_API_VERSION });
  if (!answer.ok) return answer;
  const user = answer.data.authenticatedUser;
  const displayName = user.customDisplayName?.trim() || user.providerDisplayName?.trim() || '';
  const account = user.properties?.Account?.$value?.trim();
  return ok({ id: user.id, displayName, uniqueName: account ? account : null });
}

const statesSchema = z.object({ value: z.array(z.object({ name: z.string().min(1), category: z.string().nullish() })) });

/**
 * The state "In Progress" means for this work item type: the first state in ADO's InProgress
 * category (`Active` in Agile, `Committed` in Scrum, `Doing` in Basic). Never throws.
 */
export async function inProgressStateOf(client: AdoClient, project: string, type: string, options: AssignmentCallOptions = {}): Promise<Result<string>> {
  const read = await client.get(adoPath`/${project}/_apis/wit/workitemtypes/${type}/states`, statesSchema, options);
  if (!read.ok) return read;
  const state = read.data.value.find((candidate) => toStateCategory(candidate.category) === 'in-progress');
  return state ? ok(state.name) : err('VALIDATION', `${type} has no In Progress state in ${project}.`, { reason: 'no-in-progress-state' });
}

export interface AssignmentChange {
  /** The revision the change was decided on; the write is refused when the item changed since. */
  expectedRev: number;
  /** Sign-in name to assign, or null to leave it unassigned. */
  assignee: string | null;
  state: string;
}

/**
 * Sets `System.AssignedTo` and `System.State` in one revision, guarded by `expectedRev`. Someone
 * else's change in between gives INTERNAL with `details.reason: 'changed'` and writes nothing. Never throws.
 */
export async function setWorkItemAssignment(
  client: AdoClient,
  ref: AssignmentRef,
  change: AssignmentChange,
  options: AssignmentCallOptions = {},
): Promise<Result<WorkItemAssignment>> {
  const patch = [
    { op: 'test', path: '/rev', value: change.expectedRev },
    change.assignee === null ? { op: 'remove', path: '/fields/System.AssignedTo' } : { op: 'add', path: '/fields/System.AssignedTo', value: change.assignee },
    { op: 'add', path: '/fields/System.State', value: change.state },
  ];
  const updated = await client.request({
    ...options,
    method: 'PATCH',
    path: adoPath`/${ref.project}/_apis/wit/workitems/${ref.workItemId}`,
    contentType: 'application/json-patch+json',
    body: patch,
    schema: assignmentSchema,
  });
  if (!updated.ok) {
    if (isAdoErrorDetails(updated.details) && (updated.details.status === 409 || updated.details.status === 412)) {
      return err('INTERNAL', `Work item #${ref.workItemId} changed in Azure DevOps since it was read, so nothing was written.`, {
        reason: 'changed',
        status: updated.details.status,
      });
    }
    return updated;
  }
  return ok(toAssignment(updated.data));
}
