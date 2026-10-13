import type { DiffFile } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import type { FileAttribution } from '../agent/attribution/attribution';
import { parseStatusV2 } from '../git/porcelain';
import { toChangedFiles, uncommittedPaths } from './changed-files';

const row = (overrides: Partial<DiffFile> & Pick<DiffFile, 'path'>): DiffFile => ({ oldPath: null, status: 'modified', additions: 1, deletions: 0, binary: false, ...overrides });

describe('uncommitted paths (AL-276)', () => {
  it('lists staged, unstaged, renamed and untracked paths from git status, not ignored ones', () => {
    const status = parseStatusV2(
      [
        '1 .M N... 100644 100644 100644 aaa bbb src/Grid.razor',
        '1 A. N... 000000 100644 100644 000 bbb src/Staged.cs',
        '2 R. N... 100644 100644 100644 aaa bbb R100 src/NewName.cs',
        'src/OldName.cs',
        '? notes.md',
        '! bin/Debug/app.dll',
        '',
      ].join('\0'),
    );
    expect([...uncommittedPaths(status)].sort()).toEqual(['notes.md', 'src/Grid.razor', 'src/NewName.cs', 'src/Staged.cs']);
    expect(uncommittedPaths(parseStatusV2('')).size).toBe(0);
  });
});

describe('changed files (AL-276)', () => {
  const attribution = new Map<string, FileAttribution>([
    ['src/Grid.razor', { authorAgentId: '71273', touchedBy: ['71273', 'toolu_sub'] }],
    ['src/Old.cs', { authorAgentId: 'toolu_sub', touchedBy: ['toolu_sub'] }],
  ]);

  it('maps git:diff rows: kinds, counts, rename and binary, merged by path with author and uncommitted', () => {
    const files = toChangedFiles(
      [
        row({ path: 'src/Grid.razor', additions: 120, deletions: 3 }),
        row({ path: 'src/New.cs', status: 'renamed', oldPath: 'src/Old.cs', additions: 2, deletions: 1 }),
        row({ path: 'src/Gone.cs', status: 'deleted', additions: 0, deletions: 44 }),
        row({ path: 'logo.png', status: 'added', additions: null, deletions: null, binary: true, oldPath: 'ignored.png' }),
        row({ path: 'notes.md', status: 'untracked', additions: 3, deletions: 0 }),
        row({ path: 'src/Copy.cs', status: 'copied', oldPath: 'src/Grid.razor', additions: 5, deletions: 0 }),
        row({ path: 'src/Big.cs', status: 'untracked', additions: null, deletions: 0 }),
        row({ path: 'src/Merged.cs', status: 'unmerged' }),
      ],
      attribution,
      new Set(['src/Grid.razor']),
    );
    expect(files).toEqual([
      { path: 'src/Grid.razor', oldPath: null, kind: 'modified', added: 120, removed: 3, authorAgentId: '71273', touchedBy: ['71273', 'toolu_sub'], uncommitted: true },
      // A rename takes the credit of edits made under its old path.
      { path: 'src/New.cs', oldPath: 'src/Old.cs', kind: 'renamed', added: 2, removed: 1, authorAgentId: 'toolu_sub', touchedBy: ['toolu_sub'], uncommitted: false },
      { path: 'src/Gone.cs', oldPath: null, kind: 'deleted', added: 0, removed: 44, authorAgentId: null, touchedBy: [], uncommitted: false },
      { path: 'logo.png', oldPath: null, kind: 'binary', added: 0, removed: 0, authorAgentId: null, touchedBy: [], uncommitted: false },
      // Untracked files are uncommitted whether or not status listed them.
      { path: 'notes.md', oldPath: null, kind: 'added', added: 3, removed: 0, authorAgentId: null, touchedBy: [], uncommitted: true },
      { path: 'src/Copy.cs', oldPath: null, kind: 'added', added: 5, removed: 0, authorAgentId: null, touchedBy: [], uncommitted: false },
      { path: 'src/Big.cs', oldPath: null, kind: 'added', added: 0, removed: 0, authorAgentId: null, touchedBy: [], uncommitted: true },
      { path: 'src/Merged.cs', oldPath: null, kind: 'modified', added: 1, removed: 0, authorAgentId: null, touchedBy: [], uncommitted: false },
    ]);
  });

  it('matches uncommitted paths by case', () => {
    const [file] = toChangedFiles([row({ path: 'src/Grid.razor' })], new Map(), new Set(['SRC/GRID.RAZOR']));
    expect(file?.uncommitted).toBe(true);
  });
});
