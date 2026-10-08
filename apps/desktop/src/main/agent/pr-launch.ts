import type { OpenThread } from '@agent-lanes/ado-client';
import type { ActivePullRequest } from '@agent-lanes/contracts';

/**
 * The first turn of a pull request agent from the team board (AL-238, T3, T4). The app itself changes
 * nothing in Azure DevOps: posting review comments, replying to and resolving threads and pushing are
 * the agent's own work through its skills (TB§3).
 */

/** Longest thread text quoted in the first turn; the agent reads the rest through the ADO MCP server. */
export const THREAD_TEXT_LIMIT = 400;

function quote(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > THREAD_TEXT_LIMIT ? `${line.slice(0, THREAD_TEXT_LIMIT - 1)}…` : line;
}

/** "/src/Jobs/JobNotes.razor, line 12", or "the whole pull request". */
export function threadLocation(thread: Pick<OpenThread, 'filePath' | 'line'>): string {
  if (!thread.filePath) return 'the whole pull request';
  return thread.line === null ? thread.filePath : `${thread.filePath}, line ${thread.line}`;
}

/** Code review drop (T3): a read-only review of the PR's changes, posted to the PR with /pr-comment-actioner. */
export function reviewJob(pr: Pick<ActivePullRequest, 'id' | 'title' | 'sourceBranch' | 'targetBranch' | 'author'>): string {
  return [
    `Review pull request !${pr.id} "${pr.title}" by ${pr.author.displayName}: ${pr.sourceBranch} into ${pr.targetBranch}.`,
    `Run /code-review on its changes (git diff origin/${pr.targetBranch}...HEAD in this worktree), then post each finding to the pull request as a comment on its file and line with /pr-comment-actioner.`,
    'This worktree is a read-only checkout of the source branch: change no files, commit nothing and push nothing. Other people may be reviewing the same pull request.',
  ].join('\n');
}

/**
 * Implementing drop of your own PR (T4): every unresolved thread with its file and line, worked through
 * with /pr-comment-actioner, which fixes or replies, resolves the thread and pushes.
 */
export function answerCommentsJob(pr: Pick<ActivePullRequest, 'id' | 'title' | 'sourceBranch'>, threads: readonly OpenThread[]): string {
  const lines = threads.map((thread, index) => {
    const who = thread.author ? `${thread.author}: ` : '';
    const replies = thread.replies > 0 ? ` (${thread.replies} ${thread.replies === 1 ? 'reply' : 'replies'})` : '';
    return `${index + 1}. Thread ${thread.id} · ${threadLocation(thread)} · ${who}"${quote(thread.text)}"${replies}`;
  });
  return [
    `Your pull request !${pr.id} "${pr.title}" has ${threads.length} open comment ${threads.length === 1 ? 'thread' : 'threads'}.`,
    `Work through each one with /pr-comment-actioner: fix the code and reply, or reply why not; resolve the thread; then commit and push to ${pr.sourceBranch}.`,
    '',
    'Open threads:',
    ...lines,
  ].join('\n');
}
