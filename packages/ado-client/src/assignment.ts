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
  /** Sign-in name: an email on Azure DevOps Services, `DOMAIN\\account` on Azure DevOps Server. */
  uniqueName: string | null;
}

/**
 * Whom to assign, with every name Azure DevOps may know the person by: `assigneeValues` tries them
 * in turn, because a server that rejects one ("unknown identity") often takes another.
 */
export type AssigneeIdentity = Pick<AdoPerson, 'displayName' | 'uniqueName'> & { id?: string | null };

/** The values `System.AssignedTo` is tried with, most specific first: sign-in name, identity id, display name. */
export function assigneeValues(person: AssigneeIdentity): string[] {
  const values = [person.uniqueName, person.id, person.displayName].map((value) => value?.trim() ?? '').filter(Boolean);
  return [...new Set(values)];
}

/**
 * The sign-in name `System.AssignedTo` takes, from `connectionData`'s Account and Domain properties:
 * the account as given when it is an email or already has a domain (Services, or AAD-backed Server);
 * `DOMAIN\\account` on Azure DevOps Server with Windows accounts, where the bare account
 * ("Kyle.Richards") is an unknown identity.
 */
export function signInName(account: string | null | undefined, domain: string | null | undefined): string | null {
  const name = account?.trim() ?? '';
  if (!name) return null;
  if (name.includes('@') || name.includes('\\')) return name;
  const realm = domain?.trim() ?? '';
  // A tenant id (a GUID) is no Windows domain.
  if (!realm || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(realm)) return name;
  return `${realm}\\${name}`;
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
    properties: z
      .object({
        Account: z.object({ $value: z.string().nullish() }).loose().nullish(),
        /** The Windows domain on Azure DevOps Server; a tenant id on Services. */
        Domain: z.object({ $value: z.string().nullish() }).loose().nullish(),
      })
      .loose()
      .nullish(),
  }),
});

/** Who the token signs in as, with the sign-in name an assignment needs (`_apis/connectionData`, TB§6 Identity). */
export async function getSignedInUser(client: AdoClient, options: AssignmentCallOptions = {}): Promise<Result<AdoPerson & { id: string }>> {
  const answer = await client.get('/_apis/connectionData', connectionDataSchema, { ...options, apiVersion: CONNECTION_DATA_API_VERSION });
  if (!answer.ok) return answer;
  const user = answer.data.authenticatedUser;
  const displayName = user.customDisplayName?.trim() || user.providerDisplayName?.trim() || '';
  return ok({ id: user.id, displayName, uniqueName: signInName(user.properties?.Account?.$value, user.properties?.Domain?.$value) });
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
  /** Whom to assign (a sign-in name, or a person whose names are tried in turn), or null to leave it unassigned. */
  assignee: string | AssigneeIdentity | null;
  state: string;
}

/** Azure DevOps refused the `System.AssignedTo` value as an identity it does not know. */
export function isUnknownIdentity(failure: Result<unknown>): boolean {
  if (failure.ok) return false;
  const details = isAdoErrorDetails(failure.details) ? failure.details : undefined;
  const text = `${failure.message} ${details?.adoMessage ?? ''} ${details?.adoTypeKey ?? ''}`;
  return /unknown identity|WorkItemFieldInvalidException|not a valid identity/i.test(text);
}

/**
 * Sets `System.AssignedTo` and `System.State` in one revision, guarded by `expectedRev`. Someone
 * else's change in between gives INTERNAL with `details.reason: 'changed'` and writes nothing. A person
 * is tried by each of their names (`assigneeValues`) until the server takes one: Azure DevOps Server
 * refuses a bare account name but knows the identity id and the display name. Never throws.
 */
export async function setWorkItemAssignment(
  client: AdoClient,
  ref: AssignmentRef,
  change: AssignmentChange,
  options: AssignmentCallOptions = {},
): Promise<Result<WorkItemAssignment>> {
  const values = change.assignee === null ? [null] : typeof change.assignee === 'string' ? [change.assignee] : assigneeValues(change.assignee);
  if (values.length === 0) return err('VALIDATION', `Work item #${ref.workItemId} cannot be assigned: the person has no sign-in name, id or display name.`, { reason: 'no-identity' });
  let last: Result<WorkItemAssignment> | undefined;
  for (const value of values) {
    const attempt = await writeAssignment(client, ref, value, change, options);
    // A refused value never changed the revision: the next name is tried against the same one.
    if (attempt.ok || !isUnknownIdentity(attempt) || value === values.at(-1)) return attempt;
    last = attempt;
  }
  return last ?? err('INTERNAL', 'The assignment was not written.');
}

async function writeAssignment(client: AdoClient, ref: AssignmentRef, assignee: string | null, change: AssignmentChange, options: AssignmentCallOptions): Promise<Result<WorkItemAssignment>> {
  const patch = [
    { op: 'test', path: '/rev', value: change.expectedRev },
    assignee === null ? { op: 'remove', path: '/fields/System.AssignedTo' } : { op: 'add', path: '/fields/System.AssignedTo', value: assignee },
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
