import {
  WORK_ITEM_COMMENT_MAX_LENGTH,
  WorkItemCommentTextSchema,
  WorkItemStateNameSchema,
  isAgentLanesComment,
  ok,
  withAgentLanesPrefix,
  type Result,
  type WorkItemComment,
  type WorkItemCommentFormat,
  type WorkItemStateChange,
} from '@agent-lanes/contracts';
import { z } from 'zod';
import type { AdoCallOptions, AdoClient } from './client';
import { adoErr, isAdoErrorDetails } from './errors';
import { adoPath } from './path';

/**
 * Work item write-back (AL-063, design §7 "ADO write-back"): comments through the Comments API, and
 * a state change through a JSON Patch on the work item. Whether the app may change state at all is
 * the main process's call (Settings › ADO state transitions, off by default); this module only talks
 * to ADO. Every comment the app writes starts with "Agent Lanes · ".
 */

/** The Comments API is still a preview in REST 7.1. */
export const COMMENTS_API_VERSION = '7.1-preview.4';

/** Comments per page when reading a work item's discussion; ADO's maximum `$top` is 200. */
export const COMMENTS_PAGE_SIZE = 200;

/** The work item a write-back goes to. */
export interface WorkItemRef {
  /** Project name or id. */
  project: string;
  workItemId: number;
}

export type WriteBackCallOptions = Pick<AdoCallOptions, 'signal' | 'timeoutMs'>;

export interface SetWorkItemStateOptions extends WriteBackCallOptions {
  /**
   * Plain text written to the work item's discussion with the change (as "Agent Lanes · <reason>"),
   * in the same revision, so ADO shows why the state moved. Not written when nothing changes.
   */
  reason?: string;
}

/** A comment as the Comments API returns it. Read leniently: only what the DTO needs. */
const rawCommentSchema = z.object({
  id: z.int().min(1),
  workItemId: z.int().min(1),
  text: z.string().nullish(),
  format: z.string().nullish(),
  createdBy: z.object({ displayName: z.string().nullish() }).nullish(),
  createdDate: z.string(),
  modifiedDate: z.string().nullish(),
  isDeleted: z.boolean().nullish(),
});
type RawComment = z.infer<typeof rawCommentSchema>;

/** A work item read or updated with only its state: `GET …/workitems/{id}?fields=System.State`, or the PATCH answer. */
const stateSchema = z.object({
  id: z.int().min(1),
  rev: z.int().min(1),
  fields: z.object({ 'System.State': z.string().min(1) }),
});

/**
 * Posts "Agent Lanes · <text>" to the work item's discussion (Comments API) and returns the comment
 * as ADO stored it. `text` is plain text: it is HTML-escaped and its line breaks kept, so nothing
 * in it is read as markup. The prefix is added unless the text already starts with it. Never throws.
 */
export async function addWorkItemComment(
  client: AdoClient,
  ref: WorkItemRef,
  text: string,
  options: WriteBackCallOptions = {},
): Promise<Result<WorkItemComment>> {
  const target = checkRef(ref);
  if (!target.ok) return target;
  const body = WorkItemCommentTextSchema.safeParse(text);
  if (!body.success) return invalid(`Comment text must be 1 to ${WORK_ITEM_COMMENT_MAX_LENGTH} characters.`);

  const posted = await client.request({
    ...callOptions(options),
    method: 'POST',
    path: commentsPath(target.data),
    apiVersion: COMMENTS_API_VERSION,
    query: { format: 'html' },
    body: { text: toCommentHtml(withAgentLanesPrefix(body.data)) },
    schema: rawCommentSchema,
  });
  if (!posted.ok) return posted;
  return toComment(posted.data);
}

/**
 * Every comment on the work item, oldest first, following continuation tokens; deleted comments are
 * left out. `fromAgentLanes` marks the ones the app posted. Never throws.
 */
export async function listWorkItemComments(
  client: AdoClient,
  ref: WorkItemRef,
  options: WriteBackCallOptions = {},
): Promise<Result<WorkItemComment[]>> {
  const target = checkRef(ref);
  if (!target.ok) return target;

  const listed = await client.list(commentsPath(target.data), rawCommentSchema, {
    ...callOptions(options),
    apiVersion: COMMENTS_API_VERSION,
    itemsKey: 'comments',
    query: { $top: COMMENTS_PAGE_SIZE, order: 'asc' },
  });
  if (!listed.ok) return listed;

  const comments: WorkItemComment[] = [];
  for (const raw of listed.data) {
    if (raw.isDeleted) continue;
    const comment = toComment(raw);
    if (!comment.ok) return comment;
    comments.push(comment.data);
  }
  return ok(comments);
}

/**
 * Moves the work item to `state` (a state its type defines, e.g. `Active`). Reads the current state
 * first: when the item is already there (names compared case-insensitively) nothing is written and
 * the result is `unchanged`. Otherwise one JSON Patch sets `System.State`, guarded by a `test` of the
 * revision just read, so a change someone made in between is never overwritten. ADO refuses a state
 * the work item type doesn't allow with a 400 (`VALIDATION`). Never throws.
 */
export async function setWorkItemState(
  client: AdoClient,
  ref: WorkItemRef,
  state: string,
  options: SetWorkItemStateOptions = {},
): Promise<Result<WorkItemStateChange>> {
  const target = checkRef(ref);
  if (!target.ok) return target;
  const wanted = WorkItemStateNameSchema.safeParse(state);
  if (!wanted.success) return invalid('A state name is needed: 1 to 128 characters, no control characters.');
  let reason: string | undefined;
  if (options.reason !== undefined) {
    const parsed = WorkItemCommentTextSchema.safeParse(options.reason);
    if (!parsed.success) return invalid(`The reason must be 1 to ${WORK_ITEM_COMMENT_MAX_LENGTH} characters.`);
    reason = parsed.data;
  }

  const { project, workItemId } = target.data;
  const path = adoPath`/${project}/_apis/wit/workitems/${workItemId}`;
  const call = callOptions(options);

  const current = await client.get(path, stateSchema, { ...call, query: { fields: 'System.State' } });
  if (!current.ok) return current;
  const previousState = current.data.fields['System.State'];
  if (sameState(previousState, wanted.data)) {
    return ok({ outcome: 'unchanged', workItemId, state: previousState, rev: current.data.rev });
  }

  const patch = [
    { op: 'test', path: '/rev', value: current.data.rev },
    { op: 'add', path: '/fields/System.State', value: wanted.data },
    ...(reason === undefined ? [] : [{ op: 'add', path: '/fields/System.History', value: toCommentHtml(withAgentLanesPrefix(reason)) }]),
  ];
  const updated = await client.request({
    ...call,
    method: 'PATCH',
    path,
    contentType: 'application/json-patch+json',
    body: patch,
    schema: stateSchema,
  });
  if (!updated.ok) {
    if (isAdoErrorDetails(updated.details) && (updated.details.status === 409 || updated.details.status === 412)) {
      // The revision test failed: someone changed the work item after it was read.
      const { source: _source, ...details } = updated.details;
      return adoErr(
        'INTERNAL',
        `Work item #${workItemId} changed in Azure DevOps while its state was being set, so nothing was written. Try again.`,
        details,
      );
    }
    return updated;
  }
  return ok({ outcome: 'changed', workItemId, state: updated.data.fields['System.State'], previousState, rev: updated.data.rev });
}

/**
 * Plain text as comment HTML: `&`, `<`, `>` and quotes escaped, line breaks as `<br>`. ADO keeps
 * comments as HTML, so unescaped text such as `<frmJobControl>` would vanish or become markup.
 */
export function toCommentHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r\n|\r|\n/g, '<br>');
}

function toComment(raw: RawComment): Result<WorkItemComment> {
  const createdAt = toInstant(raw.createdDate);
  const updatedAt = raw.modifiedDate ? toInstant(raw.modifiedDate) : null;
  if (createdAt === undefined || updatedAt === undefined) {
    return adoErr('VALIDATION', `Azure DevOps sent comment ${raw.id} with a date that cannot be read.`, { kind: 'schema' });
  }
  const text = raw.text ?? '';
  return ok({
    id: raw.id,
    workItemId: raw.workItemId,
    text,
    format: toFormat(raw.format),
    author: raw.createdBy?.displayName?.trim() || null,
    createdAt,
    // ADO sets modifiedDate to createdDate on a comment nobody has edited.
    updatedAt: updatedAt === createdAt ? null : updatedAt,
    fromAgentLanes: isAgentLanesComment(text),
  });
}

/** ADO sends `2026-10-07T03:04:05.1234567Z`; the DTO holds a plain ISO instant. Undefined when unreadable. */
function toInstant(value: string): string | undefined {
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

function toFormat(value: string | null | undefined): WorkItemCommentFormat {
  return value?.toLowerCase() === 'markdown' ? 'markdown' : 'html';
}

/** ADO matches state names without regard to case. */
function sameState(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function commentsPath({ project, workItemId }: WorkItemRef): string {
  return adoPath`/${project}/_apis/wit/workItems/${workItemId}/comments`;
}

const refSchema = z.object({
  project: z.string().trim().min(1),
  workItemId: z.int().min(1).max(2_147_483_647),
});

function checkRef(ref: WorkItemRef): Result<WorkItemRef> {
  const parsed = refSchema.safeParse(ref);
  return parsed.success ? ok(parsed.data) : invalid('A project and a positive work item id are needed to write back to a work item.');
}

function callOptions({ signal, timeoutMs }: WriteBackCallOptions): WriteBackCallOptions {
  return { ...(signal ? { signal } : {}), ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
}

function invalid(message: string) {
  return adoErr('VALIDATION', message, { kind: 'config' });
}
