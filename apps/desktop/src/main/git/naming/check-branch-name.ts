/**
 * Validation for a branch name the user typed in the New agent ticket modal (AL-082).
 *
 * `checkBranchName` is a pure port of `git check-ref-format --branch` (the tests compare it with the
 * installed git), plus three rules for Windows, where loose refs are files: no `" < > |`, no
 * reserved device names (`nul`, `com1`, …), and no path component ending in `.` or in `.lock` in
 * any case. It also refuses a bare `@`, which git reads as HEAD inside a repo.
 * `validateBranchName` runs it, then asks git itself, then checks the name is free.
 */
import { findConflictingBranch } from './branch-names';

export type BranchNameProblem =
  | 'empty'
  | 'leading-dash'
  | 'reserved'
  | 'bad-character'
  | 'double-dot'
  | 'at-brace'
  | 'slash'
  | 'dot-component'
  | 'lock-suffix'
  | 'trailing-dot'
  | 'windows-character'
  | 'windows-reserved'
  | 'git-rejected'
  | 'taken';

export type BranchNameCheck =
  | { ok: true }
  | {
      ok: false;
      problem: BranchNameProblem;
      /** One sentence for the modal. */
      message: string;
      /** For `taken`: the existing branch it clashes with. */
      conflictsWith?: string;
    };

const OK: BranchNameCheck = { ok: true };

function fail(problem: BranchNameProblem, message: string): BranchNameCheck {
  return { ok: false, problem, message };
}

/** Characters git refuses anywhere in a ref name (refs.c `refname_disposition`). */
function describeBadCharacter(char: string): string | undefined {
  const code = char.charCodeAt(0);
  if (code < 0x20 || code === 0x7f) return 'control characters';
  if (char === ' ') return 'spaces';
  if ('~^:?*[\\'.includes(char)) return `"${char}"`;
  return undefined;
}

const WINDOWS_BAD_CHARACTERS = '"<>|';
/** Device names Windows reserves in every folder, with or without an extension. */
const WINDOWS_RESERVED = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\..*)?$/i;

/**
 * Whether git (and a Windows file system) accepts `name` as a new branch. Pure and synchronous, so
 * it can run on every keystroke; `validateBranchName` adds git's own verdict and the collision check.
 */
export function checkBranchName(name: string): BranchNameCheck {
  if (name.length === 0) return fail('empty', 'Enter a branch name.');
  if (name.startsWith('-')) return fail('leading-dash', 'Branch names can\'t start with "-".');
  if (name === 'HEAD' || name === '@') return fail('reserved', `"${name}" is reserved by git.`);

  for (const char of name) {
    const bad = describeBadCharacter(char);
    if (bad !== undefined) return fail('bad-character', `Branch names can't contain ${bad}.`);
  }
  for (const char of name) {
    if (WINDOWS_BAD_CHARACTERS.includes(char)) {
      return fail('windows-character', `Branch names can't contain "${char}" on Windows.`);
    }
  }
  if (name.includes('..')) return fail('double-dot', 'Branch names can\'t contain "..".');
  if (name.includes('@{')) return fail('at-brace', 'Branch names can\'t contain "@{".');
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//')) {
    return fail('slash', 'Branch names can\'t start or end with "/" or contain "//".');
  }

  for (const component of name.split('/')) {
    if (component.startsWith('.')) return fail('dot-component', 'No part of a branch name can start with ".".');
    if (component.endsWith('.lock')) return fail('lock-suffix', 'No part of a branch name can end with ".lock".');
  }
  if (name.endsWith('.')) return fail('trailing-dot', 'Branch names can\'t end with ".".');

  for (const component of name.split('/')) {
    if (WINDOWS_RESERVED.test(component)) {
      return fail('windows-reserved', `"${component}" is a reserved name on Windows.`);
    }
    // Windows drops a trailing dot from folder names, and "a.LOCK" would be the lock file of "a".
    if (component.endsWith('.')) {
      return fail('windows-reserved', 'On Windows, no part of a branch name can end with ".".');
    }
    if (component.toLowerCase().endsWith('.lock')) {
      return fail('windows-reserved', 'On Windows, no part of a branch name can end with ".lock" in any case.');
    }
  }
  return OK;
}

/** Git's verdict on a branch name: resolves false when git refuses it, rejects when git can't run. */
export type CheckRefFormat = (name: string) => Promise<boolean>;

export interface ValidateBranchNameOptions {
  /** `git check-ref-format --branch`; the git service passes its runner here. */
  checkRefFormat: CheckRefFormat;
  /** Local branches plus remote ones without the remote prefix (see `findConflictingBranch`). */
  existingBranches?: Iterable<string>;
}

/**
 * Re-validates a user-edited branch name: the pure rules first (so git never sees a name that
 * could read as an option), then `git check-ref-format --branch`, then the existing branches.
 */
export async function validateBranchName(name: string, options: ValidateBranchNameOptions): Promise<BranchNameCheck> {
  const local = checkBranchName(name);
  if (!local.ok) return local;

  if (!(await options.checkRefFormat(name))) {
    return fail('git-rejected', 'Git does not accept this branch name.');
  }

  const conflictsWith = findConflictingBranch(name, options.existingBranches ?? []);
  if (conflictsWith !== undefined) {
    const message =
      conflictsWith.toLowerCase() === name.toLowerCase()
        ? `A branch named "${conflictsWith}" already exists.`
        : `Clashes with the existing branch "${conflictsWith}".`;
    return { ok: false, problem: 'taken', message, conflictsWith };
  }
  return OK;
}
