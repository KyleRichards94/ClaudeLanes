/**
 * Permission rules a repo remembers (AL-260): the same spelling as Claude Code's own
 * (`Bash(dotnet build:*)`, `WebFetch`, `Read`), kept in the repo's settings under `permissionRules`
 * and checked by `canUseTool` before a request reaches the user.
 */

/** Longest rule saved; a Bash prefix of a few words is the norm. */
export const PERMISSION_RULE_LIMIT = 200;

const SHELL_OPERATORS = /[|&;<>`$(){}]|\n/;

/**
 * The rule "Always allow" offers for a call: a Bash command's first word (and its sub-command for
 * tools like git, dotnet, npm and pnpm) as `Bash(<prefix>:*)`; the tool's own name for other tools.
 */
export function suggestedRule(toolName: string, input: Record<string, unknown>): string | null {
  if (toolName !== 'Bash') return /^[\w-]+$/.test(toolName) || toolName.startsWith('mcp__') ? toolName : null;
  const command = typeof input['command'] === 'string' ? input['command'].trim() : '';
  if (!command || SHELL_OPERATORS.test(command)) return null;
  const words = command.split(/\s+/);
  const first = words[0] ?? '';
  const subcommands = new Set(['git', 'dotnet', 'npm', 'pnpm', 'yarn', 'npx', 'docker', 'kubectl', 'gh', 'az', 'cargo', 'go', 'python', 'pip']);
  const second = words[1];
  const prefix = subcommands.has(first.toLowerCase()) && second && /^[\w.-]+$/.test(second) ? `${first} ${second}` : first;
  return `Bash(${prefix}:*)`;
}

/** Whether a saved rule lets a call through. */
export function ruleAllows(rule: string, toolName: string, input: Record<string, unknown>): boolean {
  const bash = /^Bash\((.+?):\*\)$/.exec(rule.trim());
  if (bash) {
    if (toolName !== 'Bash' || typeof input['command'] !== 'string') return false;
    const command = input['command'].trim();
    if (!command || SHELL_OPERATORS.test(command)) return false;
    const prefix = bash[1]!.trim();
    return command === prefix || command.startsWith(`${prefix} `);
  }
  return rule.trim() === toolName;
}

/** A rule as the settings keep it, or null when it is not one. */
export function normaliseRule(rule: string): string | null {
  const trimmed = rule.trim();
  if (!trimmed || trimmed.length > PERMISSION_RULE_LIMIT) return null;
  if (/^Bash\(.+:\*\)$/.test(trimmed) || /^[\w-]+$/.test(trimmed) || /^mcp__[\w-]+__[\w-]+$/.test(trimmed)) return trimmed;
  return null;
}
