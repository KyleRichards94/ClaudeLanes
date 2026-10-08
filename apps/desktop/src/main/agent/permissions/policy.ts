import type { AgentPermissions, RepoCommands } from '@agent-lanes/contracts';

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
