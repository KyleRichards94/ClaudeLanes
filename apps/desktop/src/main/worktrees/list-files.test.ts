import { describe, expect, it } from 'vitest';
import { createWorktreeFileLister, matchPaths } from './list-files';

describe('worktree files for the @ picker (AL-259)', () => {
  it('matches every word, shortest path first, and caps the list', () => {
    const paths = ['src/Jobs/JobGrid.razor', 'src/Jobs/JobFilterState.cs', 'README.md', 'src/Jobs/Tests/JobGridTests.cs'];
    expect(matchPaths(paths, 'job grid')).toEqual({ files: ['src/Jobs/JobGrid.razor', 'src/Jobs/Tests/JobGridTests.cs'], truncated: false });
    expect(matchPaths(paths, '')).toEqual({ files: ['README.md', 'src/Jobs/JobGrid.razor', 'src/Jobs/JobFilterState.cs', 'src/Jobs/Tests/JobGridTests.cs'], truncated: false });
    expect(matchPaths(Array.from({ length: 60 }, (_, index) => `f${String(index).padStart(3, '0')}.cs`), '', 50)).toMatchObject({ truncated: true });
  });

  it('lists tracked and untracked files of the ticket worktree through git', async () => {
    const calls: string[][] = [];
    const lister = createWorktreeFileLister({
      git: {
        run: async (args, options) => {
          calls.push([...args, String(options?.cwd)]);
          return { stdout: 'a.cs\0src/b.cs\0', stderr: '', code: 0 } as never;
        },
      },
      tickets: { get: async (id) => (id === '71273' ? ({ id, worktreePath: 'C:/wt/71273' } as never) : undefined) },
    });
    await expect(lister.list('71273', 'b')).resolves.toEqual({ ok: true, data: { ticketId: '71273', query: 'b', files: ['src/b.cs'], truncated: false } });
    expect(calls[0]).toEqual(['ls-files', '-z', '--cached', '--others', '--exclude-standard', 'C:/wt/71273']);
    await expect(lister.list('nope', '')).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
  });
});
