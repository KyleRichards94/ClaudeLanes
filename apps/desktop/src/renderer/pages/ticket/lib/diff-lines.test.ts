import { describe, expect, it } from 'vitest';
import { diffStats, diffStatus, fileCount, formatBytes, parseUnifiedDiff } from './diff-lines';

const patch = [
  'diff --git a/Pages/Jobs/JobControl.razor b/Pages/Jobs/JobControl.razor',
  'index 1111111..2222222 100644',
  '--- a/Pages/Jobs/JobControl.razor',
  '+++ b/Pages/Jobs/JobControl.razor',
  '@@ -10,3 +10,4 @@ @page "/jobs"',
  ' <JobGrid />',
  '-<JobFilter Old="true" />',
  '+<JobFilter State="@filter" />',
  '+<JobNotes />',
  ' </div>',
  '\\ No newline at end of file',
  '',
].join('\n');

describe('parseUnifiedDiff (AL-179)', () => {
  it('drops the file header and numbers both sides from the hunk header', () => {
    expect(parseUnifiedDiff(patch)).toEqual([
      { kind: 'hunk', text: '@@ -10,3 +10,4 @@ @page "/jobs"', oldLine: null, newLine: null },
      { kind: 'context', text: '<JobGrid />', oldLine: 10, newLine: 10 },
      { kind: 'remove', text: '<JobFilter Old="true" />', oldLine: 11, newLine: null },
      { kind: 'add', text: '<JobFilter State="@filter" />', oldLine: null, newLine: 11 },
      { kind: 'add', text: '<JobNotes />', oldLine: null, newLine: 12 },
      { kind: 'context', text: '</div>', oldLine: 12, newLine: 13 },
      { kind: 'note', text: 'No newline at end of file', oldLine: null, newLine: null },
    ]);
  });

  it('keeps `+++` and `---` inside a hunk as changed lines', () => {
    const lines = parseUnifiedDiff('@@ -1 +1 @@\n--- old rule\n+++ new rule\n');
    expect(lines.map((line) => [line.kind, line.text])).toEqual([
      ['hunk', '@@ -1 +1 @@'],
      ['remove', '-- old rule'],
      ['add', '++ new rule'],
    ]);
  });

  it('returns nothing for a patch with no hunks (a mode change)', () => {
    expect(parseUnifiedDiff('diff --git a/x b/x\nold mode 100644\nnew mode 100755\n')).toEqual([]);
  });
});

describe('diff labels', () => {
  it('names statuses, stats, counts and sizes', () => {
    expect(diffStatus('renamed')).toEqual({ letter: 'R', word: 'Renamed' });
    expect(diffStatus('untracked').letter).toBe('A');
    expect(diffStats({ additions: 214, deletions: 0, binary: false })).toBe('+214 −0');
    expect(diffStats({ additions: null, deletions: null, binary: true })).toBe('binary');
    expect(fileCount(1)).toBe('1 file');
    expect(fileCount(12)).toBe('12 files');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(256 * 1024)).toBe('256 KB');
    expect(formatBytes(1.4 * 1024 * 1024)).toBe('1.4 MB');
  });
});
