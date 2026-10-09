/**
 * The composer's `/` and `@` completions (AL-259): what is being typed, what matches, and what
 * picking an item leaves in the box. Pure, for the tests; the Composer wires it to the field.
 */

export interface CompletionQuery {
  readonly kind: 'command' | 'file';
  /** The word after the trigger, as typed so far. */
  readonly word: string;
  /** Where the trigger character sits in the text, and where the word ends. */
  readonly start: number;
  readonly end: number;
}

/**
 * A `/word` at the very start of the text (a slash command runs the whole message), or an `@word`
 * after a space or at the start (a file mention), with the caret inside or right after the word.
 */
export function completionQuery(text: string, caret: number): CompletionQuery | null {
  const upTo = text.slice(0, caret);
  const command = /^\/([\w.:-]*)$/.exec(upTo);
  if (command) return { kind: 'command', word: command[1] ?? '', start: 0, end: caret };
  const mention = /(?:^|\s)@([^\s@]*)$/.exec(upTo);
  if (mention) return { kind: 'file', word: mention[1] ?? '', start: caret - (mention[1]?.length ?? 0) - 1, end: caret };
  return null;
}

export interface CommandItem {
  readonly name: string;
  readonly description: string;
  /** "<file>" for a command that takes arguments. */
  readonly argumentHint: string;
  /** `skill`: one of the repo's skills; `command`: a Claude Code command the session lists. */
  readonly source: 'skill' | 'command';
}

/** Commands whose name or description contains the word, name matches first, at most `limit`. */
export function filterCommands(items: readonly CommandItem[], word: string, limit = 12): CommandItem[] {
  const needle = word.toLowerCase();
  const seen = new Set<string>();
  const unique = items.filter((item) => (seen.has(item.name) ? false : (seen.add(item.name), true)));
  if (needle === '') return unique.slice(0, limit);
  const byName = unique.filter((item) => item.name.toLowerCase().includes(needle));
  const byDescription = unique.filter((item) => !byName.includes(item) && item.description.toLowerCase().includes(needle));
  return [...byName.sort((a, b) => rank(a.name, needle) - rank(b.name, needle)), ...byDescription].slice(0, limit);
}

function rank(name: string, needle: string): number {
  const lower = name.toLowerCase();
  return lower === needle ? 0 : lower.startsWith(needle) ? 1 : 2;
}

/** Files whose path contains every word of the query, shortest path first, at most `limit`. */
export function filterFiles(paths: readonly string[], word: string, limit = 12): string[] {
  const words = word.toLowerCase().split(/[\s/\\]+/).filter(Boolean);
  const matches = words.length === 0 ? [...paths] : paths.filter((path) => words.every((part) => path.toLowerCase().includes(part)));
  return matches.sort((a, b) => a.length - b.length || (a < b ? -1 : 1)).slice(0, limit);
}

/** The text after picking: the trigger and word replaced by the completion, a space after it, with the caret there. */
export function applyCompletion(text: string, query: CompletionQuery, completion: string): { text: string; caret: number } {
  const replacement = `${query.kind === 'command' ? '/' : '@'}${completion} `;
  const next = `${text.slice(0, query.start)}${replacement}${text.slice(query.end)}`;
  return { text: next, caret: query.start + replacement.length };
}

/** Enter sends; Shift+Enter (or Ctrl/Cmd+Enter) adds a line; nothing while composing IME text (AL-259). */
export function isSendKey(event: { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; isComposing?: boolean }): boolean {
  return event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.isComposing;
}
