import type { AgentPermissions, RepoCommands, TicketRecord } from '@agent-lanes/contracts';

/**
 * The headless permission policy (AL-109, Decision D18): which Bash commands a ticket's agent runs
 * without asking. Pure, so the session extras and the tests share it.
 */

/**
 * Git commands that only read. A command is allowed when it is one of these or starts with one
 * followed by a space, so `git branch` itself (which can delete branches with `-D`) is not listed.
 */
export const GIT_READ_COMMANDS = [
  'git status',
  'git diff',
  'git log',
  'git show',
  'git rev-parse',
  'git ls-files',
  'git blame',
  'git grep',
  'git merge-base',
  'git describe',
  'git shortlog',
  'git cat-file',
  'git remote -v',
  'git branch --show-current',
  'git branch --list',
] as const;

/**
 * Characters that chain, substitute or redirect in a shell. A command holding any of them is never
 * allowed by prefix: `git status && rm -rf .` must ask.
 */
const SHELL_OPERATORS = /[;&|`$<>\r\n]/;

/** The repo's test command, from what was detected in the worktree: `dotnet test`, `pnpm test`. */
export function testCommands(commands: RepoCommands | null): string[] {
  const detected = commands?.detected;
  if (!detected) return [];
  if (detected.toolchain === 'dotnet') return ['dotnet test'];
  const manager = detected.packageManager ?? 'npm';
  return [`${manager} test`, `${manager} run test`];
}

/** Every Bash command prefix the policy allows for a ticket whose repo has `commands`. */
export function allowedBashPrefixes(policy: AgentPermissions, commands: RepoCommands | null): string[] {
  const prefixes: string[] = [];
  if (policy.gitRead) prefixes.push(...GIT_READ_COMMANDS);
  if (policy.buildAndTest) {
    if (commands?.build) prefixes.push(commands.build.command);
    prefixes.push(...testCommands(commands));
  }
  prefixes.push(...policy.bashAllow);
  return [...new Set(prefixes.map((prefix) => prefix.trim()).filter((prefix) => prefix && !SHELL_OPERATORS.test(prefix)))];
}

/** Whether a Bash command is one of `prefixes` or starts with one followed by a space, with no shell operators. */
export function bashCommandAllowed(command: string, prefixes: readonly string[]): boolean {
  const trimmed = command.trim();
  if (!trimmed || SHELL_OPERATORS.test(trimmed)) return false;
  return prefixes.some((prefix) => trimmed === prefix || trimmed.startsWith(`${prefix} `));
}

/** The same prefixes as Claude Code permission rules, so the CLI allows them without asking at all. */
export function bashAllowRules(prefixes: readonly string[]): string[] {
  return prefixes.map((prefix) => `Bash(${prefix}:*)`);
}

// ── Work item comments (Kyle: "QA fails or QA fail answers, nothing else") ─────────────────────────

/** The heading a QA failure report starts with. */
export const QA_FAILED_HEADING = 'QA failed';
/** The heading an answer to a QA failure starts with. */
export const QA_FAIL_ANSWER_HEADING = 'QA fail answer';

/** What the agent reads when a work item comment is refused; never a Needs-you prompt. */
export const WORK_ITEM_COMMENT_DENIED = 'Agent Lanes only allows work item comments that report or answer a QA failure.';

/** The rule as the session prompt states it. */
export const WORK_ITEM_COMMENT_RULE = [
  'Comment on the work item only to report a QA failure or to answer one; post nothing else there (no progress notes, plans or summaries).',
  `A QA failure report starts with the heading "${QA_FAILED_HEADING}", is posted while the ticket is in the QA stage, and lists each failed acceptance criterion with its evidence.`,
  `An answer starts with the heading "${QA_FAIL_ANSWER_HEADING}", is posted on a ticket QA or UAT sent back (the item came from Failed, or QA moved it back to Implementing), and says what was fixed for each failure.`,
  'Agent Lanes refuses any other work item comment.',
].join(' ');

export type WorkItemCommentKind = 'qa-failed' | 'qa-fail-answer';

/** What the gate needs to know about the ticket. */
export type CommentTicket = Pick<TicketRecord, 'stage' | 'stageHistory' | 'ado'>;

export type WorkItemCommentVerdict = { allowed: true; kind: WorkItemCommentKind } | { allowed: false; message: string };

const READ_ONLY_TOOL = /(^|_)(get|list|read|search|query)(_|$)/;
const COMMENT_TEXT_KEYS = ['comment', 'text', 'body', 'content', 'message'] as const;

/** `System.History` set through a field update is a discussion comment too. */
function historyValues(value: unknown, depth = 0): string[] {
  if (depth > 6 || value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((item) => historyValues(item, depth + 1));
  const object = value as Record<string, unknown>;
  const found: string[] = [];
  const path = object['path'] ?? object['field'] ?? object['referenceName'] ?? object['name'];
  if (typeof path === 'string' && /system\.history$/i.test(path) && typeof object['value'] === 'string') found.push(object['value']);
  for (const [key, inner] of Object.entries(object)) {
    if (/^(\/fields\/)?system\.history$/i.test(key) && typeof inner === 'string') found.push(inner);
    else if (typeof inner === 'object') found.push(...historyValues(inner, depth + 1));
  }
  return found;
}

/**
 * The text of the work item comment an MCP tool call would post, or null when the call posts none:
 * a work item comment tool (`wit_add_work_item_comment`, any server), or a work item update that sets
 * `System.History` (which shows in the discussion). Pull request comments are not work item comments.
 */
export function workItemCommentBody(toolName: string, input: Record<string, unknown>): string | null {
  const mcp = /^mcp__.+?__(.+)$/.exec(toolName);
  if (!mcp) return null;
  const tool = mcp[1]!.toLowerCase();
  if (READ_ONLY_TOOL.test(tool)) return null;
  if (/pull_?request|(^|_)pr(_|$)|repo_|thread/.test(tool)) return null;
  if (/work_?items?/.test(tool) && /comment/.test(tool)) {
    for (const key of COMMENT_TEXT_KEYS) if (typeof input[key] === 'string') return input[key];
    return '';
  }
  if (/work_?items?|(^|_)wit_/.test(tool)) {
    const history = historyValues(input);
    if (history.length > 0) return history.join('\n');
  }
  return null;
}

/** Which heading the comment starts with, ignoring Markdown or HTML around it and case. */
export function workItemCommentKind(body: string): WorkItemCommentKind | null {
  const text = body
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/^[\s#>*_\-=`~:|]+/, '')
    .trimStart()
    .toLowerCase();
  if (/^qa\s+fail(ed|ure)?\s+answer\b/.test(text) || /^answer\s+to\s+qa\s+fail/.test(text)) return 'qa-fail-answer';
  if (/^qa\s+(failed|fail(ure)?)\b/.test(text)) return 'qa-failed';
  return null;
}

/**
 * Whether a work item comment may be posted: a "QA failed" report while the ticket is in QA, or a
 * "QA fail answer" on a ticket QA sent back (it has been in QA) or that came from the board's Failed
 * column. Anything else is refused with a message the agent can act on.
 */
export function workItemCommentVerdict(body: string, ticket: CommentTicket | undefined): WorkItemCommentVerdict {
  const kind = workItemCommentKind(body);
  if (!kind) {
    return {
      allowed: false,
      message: `${WORK_ITEM_COMMENT_DENIED} Start a QA failure report with "${QA_FAILED_HEADING}" and an answer with "${QA_FAIL_ANSWER_HEADING}"; otherwise put what you wanted to say in your reply instead.`,
    };
  }
  if (!ticket) return { allowed: false, message: `${WORK_ITEM_COMMENT_DENIED} This ticket's record could not be read.` };
  if (kind === 'qa-failed') {
    return ticket.stage === 'qa'
      ? { allowed: true, kind }
      : { allowed: false, message: `${WORK_ITEM_COMMENT_DENIED} A "${QA_FAILED_HEADING}" report is posted only while the ticket is in the QA stage.` };
  }
  const sentBack = ticket.ado?.fromFailed === true || ticket.stageHistory.some((entry) => entry.stage === 'qa');
  return sentBack
    ? { allowed: true, kind }
    : {
        allowed: false,
        message: `${WORK_ITEM_COMMENT_DENIED} A "${QA_FAIL_ANSWER_HEADING}" is posted only on a ticket QA or UAT sent back (from Failed, or moved back from QA).`,
      };
}
