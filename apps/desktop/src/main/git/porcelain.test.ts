import { describe, expect, it } from 'vitest';
import { GitError } from './git-error';
import { compareGitVersions, parseGitVersion, MIN_GIT_VERSION } from './git-version';
import {
  hasConflicts,
  isCleanStatus,
  parseLeftRightCount,
  parseStatusV2,
  parseWorktreeList,
  unquoteGitPath,
} from './porcelain';

const OID = 'a'.repeat(40);
const OID2 = 'b'.repeat(40);
const z = (...records: string[]) => records.map((record) => `${record}\0`).join('');

describe('parseStatusV2', () => {
  it('reads branch headers and every entry kind from -z output', () => {
    const output = z(
      `# branch.oid ${OID}`,
      '# branch.head 71273-cutover',
      '# branch.upstream origin/71273-cutover',
      '# branch.ab +2 -1',
      '# stash 3',
      `1 .M N... 100644 100644 100644 ${OID} ${OID} src/app file.ts`,
      `1 A. N... 000000 100644 100644 ${OID} ${OID} new "quoted" 'name'.txt`,
      `2 R. N... 100644 100644 100644 ${OID} ${OID} R100 docs/after name.md`,
      'docs/before name.md',
      `2 C. N... 100644 100644 100644 ${OID} ${OID} C75 copy.ts`,
      'orig.ts',
      `u UU N... 100644 100644 100644 100644 ${OID} ${OID2} ${OID} conflict.cs`,
      '? untracked dir/',
      '? line\nbreak.txt',
      '! bin/',
    );

    const status = parseStatusV2(output);

    expect(status.branch).toEqual({
      oid: OID,
      head: '71273-cutover',
      detached: false,
      upstream: 'origin/71273-cutover',
      ahead: 2,
      behind: 1,
    });
    expect(status.stash).toBe(3);
    expect(status.entries).toEqual([
      { kind: 'changed', index: '.', worktree: 'M', submodule: 'N...', path: 'src/app file.ts' },
      { kind: 'changed', index: 'A', worktree: '.', submodule: 'N...', path: `new "quoted" 'name'.txt` },
      {
        kind: 'renamed',
        index: 'R',
        worktree: '.',
        submodule: 'N...',
        score: 100,
        path: 'docs/after name.md',
        originalPath: 'docs/before name.md',
      },
      { kind: 'copied', index: 'C', worktree: '.', submodule: 'N...', score: 75, path: 'copy.ts', originalPath: 'orig.ts' },
      { kind: 'unmerged', index: 'U', worktree: 'U', submodule: 'N...', path: 'conflict.cs' },
      { kind: 'untracked', path: 'untracked dir/' },
      { kind: 'untracked', path: 'line\nbreak.txt' },
      { kind: 'ignored', path: 'bin/' },
    ]);
    expect(isCleanStatus(status)).toBe(false);
    expect(hasConflicts(status)).toBe(true);
  });

  it('reads an initial commit, a detached HEAD and a missing upstream', () => {
    expect(parseStatusV2(z('# branch.oid (initial)', '# branch.head main')).branch).toEqual({
      oid: null,
      head: 'main',
      detached: false,
      upstream: null,
      ahead: null,
      behind: null,
    });
    expect(parseStatusV2(z(`# branch.oid ${OID}`, '# branch.head (detached)')).branch).toMatchObject({
      oid: OID,
      head: null,
      detached: true,
    });
  });

  it('treats a status with only ignored files as clean, and empty output as clean without branch info', () => {
    const onlyIgnored = parseStatusV2(z('# branch.oid (initial)', '# branch.head main', '! node_modules/'));
    expect(isCleanStatus(onlyIgnored)).toBe(true);
    expect(hasConflicts(onlyIgnored)).toBe(false);

    const empty = parseStatusV2('');
    expect(empty).toEqual({ branch: null, entries: [], stash: null });
    expect(isCleanStatus(empty)).toBe(true);
  });

  it('unquotes C-quoted paths in line output, including renames separated by a tab', () => {
    const output = [
      `1 .M N... 100644 100644 100644 ${OID} ${OID} "caf\\303\\251 \\"menu\\".txt"`,
      `2 R. N... 100644 100644 100644 ${OID} ${OID} R90 "new\\tname.txt"\told name.txt`,
      '? "tab\\there"',
      '',
    ].join('\n');

    expect(parseStatusV2(output).entries).toEqual([
      { kind: 'changed', index: '.', worktree: 'M', submodule: 'N...', path: 'café "menu".txt' },
      {
        kind: 'renamed',
        index: 'R',
        worktree: '.',
        submodule: 'N...',
        score: 90,
        path: 'new\tname.txt',
        originalPath: 'old name.txt',
      },
      { kind: 'untracked', path: 'tab\there' },
    ]);
  });

  it('ignores unknown headers but rejects unknown or malformed records', () => {
    expect(parseStatusV2(z('# branch.future value', '# something-else 1')).entries).toEqual([]);

    expect(() => parseStatusV2(z('X what is this'))).toThrow(GitError);
    expect(() => parseStatusV2(z('1 .M N...'))).toThrow(/Could not read git status/);
    expect(() => parseStatusV2(z('# branch.ab nonsense'))).toThrow(/branch\.ab/);
    expect(() => parseStatusV2(z(`2 R. N... 100644 100644 100644 ${OID} ${OID} R100 only-one-path`))).toThrow(
      /no original path/,
    );
    expect(() => parseStatusV2(z('Z'))).toThrow(expect.objectContaining({ name: 'GitError', code: 'PARSE_FAILED' }));
  });
});

describe('parseWorktreeList', () => {
  it('reads -z output with branches, detached and bare entries, locks and prunable worktrees', () => {
    const output = z(
      'worktree C:/repos/onsite',
      `HEAD ${OID}`,
      'branch refs/heads/main',
      '',
      'worktree C:/repos/.agent-lanes/71273 with space',
      `HEAD ${OID2}`,
      `branch refs/heads/71273-"quoted"-'name'`,
      'locked agent running\nsecond line',
      '',
      'worktree C:/repos/.agent-lanes/detached',
      `HEAD ${OID}`,
      'detached',
      'prunable gitdir file points to non-existent location',
      '',
      'worktree C:/repos/bare.git',
      'bare',
      'some-future-attribute value',
      '',
    );

    expect(parseWorktreeList(output)).toEqual([
      {
        path: 'C:/repos/onsite',
        head: OID,
        branchRef: 'refs/heads/main',
        branch: 'main',
        detached: false,
        bare: false,
        locked: false,
        lockedReason: null,
        prunable: false,
        prunableReason: null,
      },
      {
        path: 'C:/repos/.agent-lanes/71273 with space',
        head: OID2,
        branchRef: `refs/heads/71273-"quoted"-'name'`,
        branch: `71273-"quoted"-'name'`,
        detached: false,
        bare: false,
        locked: true,
        lockedReason: 'agent running\nsecond line',
        prunable: false,
        prunableReason: null,
      },
      {
        path: 'C:/repos/.agent-lanes/detached',
        head: OID,
        branchRef: null,
        branch: null,
        detached: true,
        bare: false,
        locked: false,
        lockedReason: null,
        prunable: true,
        prunableReason: 'gitdir file points to non-existent location',
      },
      {
        path: 'C:/repos/bare.git',
        head: null,
        branchRef: null,
        branch: null,
        detached: false,
        bare: true,
        locked: false,
        lockedReason: null,
        prunable: false,
        prunableReason: null,
      },
    ]);
  });

  it('reads line output, with a bare "locked" and a quoted reason', () => {
    const lines = [
      'worktree /home/dev/repo',
      `HEAD ${OID}`,
      'branch refs/heads/main',
      'locked',
      '',
      'worktree /home/dev/wt',
      `HEAD ${OID}`,
      'detached',
      'locked "reason with\\nnewline"',
      '',
    ].join('\n');

    const [main, wt] = parseWorktreeList(lines);
    expect(main).toMatchObject({ path: '/home/dev/repo', branch: 'main', locked: true, lockedReason: null });
    expect(wt).toMatchObject({ path: '/home/dev/wt', detached: true, locked: true, lockedReason: 'reason with\nnewline' });
  });

  it('returns nothing for empty output and rejects attributes before a worktree line', () => {
    expect(parseWorktreeList('')).toEqual([]);
    expect(() => parseWorktreeList(z(`HEAD ${OID}`))).toThrow(/before any worktree line/);
  });
});

describe('parseLeftRightCount', () => {
  it('reads the two tab-separated counts', () => {
    expect(parseLeftRightCount('3\t5\n')).toEqual({ left: 3, right: 5 });
    expect(parseLeftRightCount('0\t0')).toEqual({ left: 0, right: 0 });
  });

  it('rejects anything else', () => {
    expect(() => parseLeftRightCount('')).toThrow(GitError);
    expect(() => parseLeftRightCount('3\n')).toThrow(/expected two counts/);
    expect(() => parseLeftRightCount('a\tb')).toThrow(GitError);
  });
});

describe('unquoteGitPath', () => {
  it('leaves unquoted text alone and decodes escapes and octal UTF-8 bytes', () => {
    expect(unquoteGitPath('plain name.txt')).toBe('plain name.txt');
    expect(unquoteGitPath('"a\\\\b\\"c\\n"')).toBe('a\\b"c\n');
    expect(unquoteGitPath('"\\346\\227\\245\\346\\234\\254.md"')).toBe('日本.md');
  });
});

describe('git version', () => {
  it('parses the forms git prints on Windows, macOS and Linux', () => {
    expect(parseGitVersion('git version 2.54.0.windows.1\n')).toEqual({ major: 2, minor: 54, patch: 0 });
    expect(parseGitVersion('git version 2.39.3 (Apple Git-146)')).toEqual({ major: 2, minor: 39, patch: 3 });
    expect(parseGitVersion('git version 2.38')).toEqual({ major: 2, minor: 38, patch: 0 });
    expect(parseGitVersion('not git')).toBeNull();
  });

  it('compares against the 2.38 minimum', () => {
    expect(MIN_GIT_VERSION).toEqual({ major: 2, minor: 38, patch: 0 });
    expect(compareGitVersions({ major: 2, minor: 37, patch: 9 }, MIN_GIT_VERSION)).toBeLessThan(0);
    expect(compareGitVersions({ major: 2, minor: 38, patch: 0 }, MIN_GIT_VERSION)).toBe(0);
    expect(compareGitVersions({ major: 2, minor: 100, patch: 0 }, MIN_GIT_VERSION)).toBeGreaterThan(0);
    expect(compareGitVersions({ major: 3, minor: 0, patch: 0 }, MIN_GIT_VERSION)).toBeGreaterThan(0);
    expect(compareGitVersions({ major: 1, minor: 99, patch: 99 }, MIN_GIT_VERSION)).toBeLessThan(0);
  });
});
