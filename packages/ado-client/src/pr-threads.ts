import { ok, type Result } from '@agent-lanes/contracts';
import { z } from 'zod';
import { isUnresolvedThread } from './active-prs';
import type { AdoCallOptions, AdoClient } from './client';
import { adoPath } from './path';

/**
 * A pull request's open comment threads with where they point (AL-238, T4): the first turn of an agent
 * answering them lists every unresolved thread with its file and line, so it can work through each one
 * with /pr-comment-actioner.
 */

/** One unresolved thread, as the first turn lists it. */
export interface OpenThread {
  id: number;
  /** Repository-relative path (`/src/Jobs/JobNotes.razor`); null for a thread on the whole PR. */
  filePath: string | null;
  /** The line on the PR's side (right), else the left side's; null without a position. */
  line: number | null;
  /** Who opened the thread. */
  author: string | null;
  /** The thread's first comment, as written. */
  text: string;
  /** Replies after the first comment. */
  replies: number;
}

const positionSchema = z.object({ line: z.number() }).nullish();

const threadSchema = z.object({
  id: z.number(),
  status: z.string().nullish(),
  isDeleted: z.boolean().nullish(),
  threadContext: z.object({ filePath: z.string().nullish(), rightFileStart: positionSchema, leftFileStart: positionSchema }).nullish(),
  comments: z
    .array(
      z.object({
        commentType: z.string().nullish(),
        isDeleted: z.boolean().nullish(),
        content: z.string().nullish(),
        author: z.object({ displayName: z.string().nullish() }).nullish(),
      }),
    )
    .nullish(),
});
const threadsSchema = z.object({ value: z.array(threadSchema) });

/** The PR's unresolved threads (active, not deleted, written by someone), oldest first. Never throws. */
export async function listOpenThreads(
  client: AdoClient,
  ref: { project: string; repositoryId: string; pullRequestId: number },
  options: Pick<AdoCallOptions, 'signal' | 'timeoutMs'> = {},
): Promise<Result<OpenThread[]>> {
  const read = await client.get(adoPath`/${ref.project}/_apis/git/repositories/${ref.repositoryId}/pullRequests/${ref.pullRequestId}/threads`, threadsSchema, options);
  if (!read.ok) return read;
  const open = read.data.value.filter(isUnresolvedThread).map((thread): OpenThread => {
    const written = (thread.comments ?? []).filter((comment) => !comment.isDeleted && comment.commentType?.toLowerCase() !== 'system');
    const first = written[0];
    const context = thread.threadContext;
    return {
      id: thread.id,
      filePath: context?.filePath ?? null,
      line: context?.rightFileStart?.line ?? context?.leftFileStart?.line ?? null,
      author: first?.author?.displayName ?? null,
      text: (first?.content ?? '').trim(),
      replies: Math.max(0, written.length - 1),
    };
  });
  return ok(open.toSorted((a, b) => a.id - b.id));
}
