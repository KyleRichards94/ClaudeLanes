import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { checkBranchName, validateBranchName, type BranchNameProblem, type CheckRefFormat } from './check-branch-name';
import { createGitCheckRefFormat } from './git-check-ref-format';

/** [name, our verdict (problem or null for ok), what `git check-ref-format --branch` says]. */
const CASES: [string, BranchNameProblem | null, boolean][] = [
  ['foo', null, true],
  ['71273-cutover-frmjobcontrol-to', null, true],
  ['sub/71273-grid', null, true],
  ['Kyle/Feature-Ünïcode', null, true],
  ['a{b}', null, true],
  ['a@b', null, true],
  ['@x', null, true],
  ['x@', null, true],
  ['console', null, true],
  ['nul-fix', null, true],
  ['auxiliary/com10', null, true],
  ['', 'empty', false],
  ['-foo', 'leading-dash', false],
  ['HEAD', 'reserved', false],
  // Git accepts a bare "@" outside a repo but reads it as HEAD inside one.
  ['@', 'reserved', true],
  ['a b', 'bad-character', false],
  ['a\tb', 'bad-character', false],
  ['a\u0001b', 'bad-character', false],
  ['a\u007Fb', 'bad-character', false],
  ['a~b', 'bad-character', false],
  ['a^b', 'bad-character', false],
  ['a:b', 'bad-character', false],
  ['a?b', 'bad-character', false],
  ['a*b', 'bad-character', false],
  ['a[b', 'bad-character', false],
  ['a\\b', 'bad-character', false],
  ['a..b', 'double-dot', false],
  ['a@{b', 'at-brace', false],
  ['/a', 'slash', false],
  ['a/', 'slash', false],
  ['a//b', 'slash', false],
  ['.a', 'dot-component', false],
  ['a/.b', 'dot-component', false],
  ['a.lock', 'lock-suffix', false],
  ['a.lock/b', 'lock-suffix', false],
  ['a.', 'trailing-dot', false],
  ['a/b.', 'trailing-dot', false],
  // Git accepts these, but a loose ref is a file and Windows can't create these file names.
  ['a"b', 'windows-character', true],
  ['a<b', 'windows-character', true],
  ['a>b', 'windows-character', true],
  ['a|b', 'windows-character', true],
  ['nul', 'windows-reserved', true],
  ['CON', 'windows-reserved', true],
  ['feature/aux', 'windows-reserved', true],
  ['lpt9.txt', 'windows-reserved', true],
  ['a./b', 'windows-reserved', true],
  ['a.LOCK', 'windows-reserved', true],
];

describe('checkBranchName', () => {
  it.each(CASES)('%j → %s', (name, problem) => {
    const result = checkBranchName(name);
    if (problem === null) {
      expect(result).toEqual({ ok: true });
    } else {
      expect(result).toMatchObject({ ok: false, problem });
      if (!result.ok) expect(result.message).not.toBe('');
    }
  });

  it('names the offending character', () => {
    expect(checkBranchName('fix grid')).toMatchObject({ message: "Branch names can't contain spaces." });
    expect(checkBranchName('fix~grid')).toMatchObject({ message: 'Branch names can\'t contain "~".' });
  });
});

describe('checkBranchName against git', () => {
  let cwd: string;

  beforeAll(async () => {
    // Outside any repository, so git can't expand names like "@" against a HEAD.
    cwd = await mkdtemp(join(tmpdir(), 'agent-lanes-refname-'));
  });

  afterAll(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it('agrees with `git check-ref-format --branch` and is never more permissive', async () => {
    const gitAccepts = createGitCheckRefFormat({ cwd });
    const verdicts = await Promise.all(CASES.map(async ([name]) => [name, await gitAccepts(name)] as const));

    expect(verdicts).toEqual(CASES.map(([name, , git]) => [name, git]));
    for (const [name, git] of verdicts) {
      if (checkBranchName(name).ok) expect(git, name).toBe(true);
    }
  }, 60_000);

  it('passes names with spaces, quotes or shell syntax to git as one argument', async () => {
    const gitAccepts = createGitCheckRefFormat({ cwd });
    // Through a shell, git would see only "ok" and accept it.
    await expect(gitAccepts('ok && echo hacked')).resolves.toBe(false);
    // Through a shell, these would be unbalanced quotes or a second command.
    await expect(gitAccepts('a"b')).resolves.toBe(true);
    await expect(gitAccepts("it's")).resolves.toBe(true);
    await expect(gitAccepts('ok;echo')).resolves.toBe(true);
  }, 30_000);

  it('never hands git a name that reads as an option', async () => {
    const gitAccepts = createGitCheckRefFormat({ cwd, gitPath: join(cwd, 'no-such-git') });
    await expect(gitAccepts('--help')).resolves.toBe(false);
  });

  it('rejects when git cannot run', async () => {
    const gitAccepts = createGitCheckRefFormat({ cwd, gitPath: join(cwd, 'no-such-git') });
    await expect(gitAccepts('foo')).rejects.toThrow();
  });
});

describe('validateBranchName', () => {
  function fakeGit(accepts: boolean) {
    return vi.fn<CheckRefFormat>(async () => accepts);
  }

  it('accepts a free, valid name', async () => {
    const checkRefFormat = fakeGit(true);
    await expect(
      validateBranchName('71273-grid-rework', { checkRefFormat, existingBranches: ['main', '71273-grid'] }),
    ).resolves.toEqual({ ok: true });
    expect(checkRefFormat).toHaveBeenCalledWith('71273-grid-rework');
  });

  it.each(['-f', 'a b', 'a"b', 'a@{-1}', ''])('stops %j before it reaches git', async (name) => {
    const checkRefFormat = fakeGit(true);
    const result = await validateBranchName(name, { checkRefFormat });
    expect(result.ok).toBe(false);
    expect(checkRefFormat).not.toHaveBeenCalled();
  });

  it('reports what git rejects', async () => {
    await expect(validateBranchName('fine', { checkRefFormat: fakeGit(false) })).resolves.toMatchObject({
      ok: false,
      problem: 'git-rejected',
    });
  });

  it('reports an existing branch with the same name, ignoring case', async () => {
    await expect(
      validateBranchName('71273-grid', { checkRefFormat: fakeGit(true), existingBranches: ['71273-Grid'] }),
    ).resolves.toEqual({
      ok: false,
      problem: 'taken',
      message: 'A branch named "71273-Grid" already exists.',
      conflictsWith: '71273-Grid',
    });
  });

  it('reports a clash with a branch path', async () => {
    await expect(
      validateBranchName('kyle', { checkRefFormat: fakeGit(true), existingBranches: ['kyle/spike'] }),
    ).resolves.toEqual({
      ok: false,
      problem: 'taken',
      message: 'Clashes with the existing branch "kyle/spike".',
      conflictsWith: 'kyle/spike',
    });
  });

  it('passes on a git failure instead of guessing', async () => {
    const checkRefFormat = vi.fn<CheckRefFormat>(async () => {
      throw new Error('spawn git ENOENT');
    });
    await expect(validateBranchName('fine', { checkRefFormat })).rejects.toThrow('ENOENT');
  });

  it('accepts the design example with the real git', async () => {
    await expect(
      validateBranchName('71273-cutover-frmjobcontrol-to', { checkRefFormat: createGitCheckRefFormat() }),
    ).resolves.toEqual({ ok: true });
  }, 30_000);
});
