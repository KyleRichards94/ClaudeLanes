import type { ChangedFile } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { UNKNOWN_AGENT_COLOR } from '@/shared/config';
import { authorOf, changeTotals, coAuthorsOf, linesChanged, sortedByChange } from './changes';

function file(path: string, added: number, removed: number, overrides: Partial<ChangedFile> = {}): ChangedFile {
  return { path, oldPath: null, kind: 'modified', added, removed, authorAgentId: null, touchedBy: [], uncommitted: false, ...overrides };
}

const agents = [
  { id: '71273', name: 'Lead', color: '#5B4BC4' },
  { id: 'toolu_1', name: 'razor-writer', color: '#0369A1' },
];

describe('changed files (AL-276)', () => {
  it('credits a file to its author agent with that agent’s colour', () => {
    expect(authorOf(file('a.cs', 1, 0, { authorAgentId: 'toolu_1' }), agents)).toEqual({ agentId: 'toolu_1', name: 'razor-writer', color: '#0369A1' });
  });

  it('draws a file with no recorded author as "you or a merge" in neutral grey', () => {
    expect(authorOf(file('a.cs', 1, 0), agents)).toEqual({ agentId: null, name: 'you or a merge', color: UNKNOWN_AGENT_COLOR });
    expect(UNKNOWN_AGENT_COLOR).toBe('#94A3B8');
  });

  it('keeps the grey for an author that is no longer among the agents', () => {
    expect(authorOf(file('a.cs', 1, 0, { authorAgentId: 'gone' }), agents)).toMatchObject({ agentId: 'gone', color: UNKNOWN_AGENT_COLOR });
  });

  it('sorts the largest change first, then by path, and totals the lines', () => {
    const files = [file('b.cs', 5, 0), file('a.cs', 2, 3), file('c.cs', 40, 2)];
    expect(sortedByChange(files).map((f) => f.path)).toEqual(['c.cs', 'a.cs', 'b.cs']);
    expect(linesChanged(files[1]!)).toBe(5);
    expect(changeTotals(files)).toEqual({ files: 3, added: 47, removed: 5 });
  });

  it('lists the other agents that touched a file', () => {
    expect(coAuthorsOf(file('a.cs', 1, 0, { authorAgentId: 'toolu_1', touchedBy: ['71273', 'toolu_1'] }))).toEqual(['71273']);
  });
});
