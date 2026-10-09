import { describe, expect, it } from 'vitest';
import { editDiff } from './edit-diff';
import { isRowExpanded, resetExpandedRows, toggleRowExpanded } from './expanded';

describe('editDiff (AL-256)', () => {
  it('keeps unchanged lines as context and marks the rest removed or added', () => {
    expect(editDiff('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { kind: 'context', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'context', text: 'c' },
      { kind: 'added', text: 'd' },
    ]);
  });

  it('reads a Write as all added, a deletion as all removed, and ignores a trailing newline', () => {
    expect(editDiff('', 'x\ny\n')).toEqual([{ kind: 'added', text: 'x' }, { kind: 'added', text: 'y' }]);
    expect(editDiff('x\r\ny', '')).toEqual([{ kind: 'removed', text: 'x' }, { kind: 'removed', text: 'y' }]);
    expect(editDiff('same', 'same')).toEqual([{ kind: 'context', text: 'same' }]);
  });
});

describe('expanded rows (AL-256)', () => {
  it('toggles per ticket and row and can be reset', () => {
    resetExpandedRows();
    expect(isRowExpanded('71273', 'tA')).toBe(false);
    toggleRowExpanded('71273', 'tA');
    expect(isRowExpanded('71273', 'tA')).toBe(true);
    expect(isRowExpanded('71274', 'tA')).toBe(false);
    toggleRowExpanded('71273', 'tA');
    expect(isRowExpanded('71273', 'tA')).toBe(false);
    toggleRowExpanded('71273', 'tB');
    resetExpandedRows();
    expect(isRowExpanded('71273', 'tB')).toBe(false);
  });
});
