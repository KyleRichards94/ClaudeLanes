import type { ReviewFinding } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { REVIEW_STATUS_LABELS, findingsFor, reviewStatusOf, reviewedCount, worstSeverity } from './findings';

const finding = (id: string, filePath: string, line: number | null, severity: ReviewFinding['severity'] = 'warn'): ReviewFinding => ({ id, filePath, line, severity, text: 'x', agentId: 'rev' });

describe('review findings (AL-277)', () => {
  const findings = [finding('b', 'a.cs', 40), finding('a', 'a.cs', 7, 'error'), finding('c', 'b.cs', 1, 'info'), finding('d', 'a.cs', null, 'info')];

  it('picks a file’s findings in line order, a finding with no line first', () => {
    expect(findingsFor(findings, 'a.cs').map((f) => f.id)).toEqual(['d', 'a', 'b']);
    expect(findingsFor(findings, 'none.cs')).toEqual([]);
    expect(findingsFor(undefined, 'a.cs')).toEqual([]);
    expect(findingsFor(findings, null)).toEqual([]);
  });

  it('reads a file’s review status, not reviewed when there is no entry or no response yet', () => {
    const response = { reviewStatus: { 'a.cs': 'changesRequested' as const } };
    expect(reviewStatusOf(response, 'a.cs')).toBe('changesRequested');
    expect(reviewStatusOf(response, 'b.cs')).toBe('notReviewed');
    expect(reviewStatusOf(undefined, 'a.cs')).toBe('notReviewed');
    expect(REVIEW_STATUS_LABELS.inReview).toBe('In review');
  });

  it('finds the worst severity and counts reviewed files', () => {
    expect(worstSeverity(findings)).toBe('error');
    expect(worstSeverity([])).toBeNull();
    const files = [{ path: 'a.cs' }, { path: 'b.cs' }, { path: 'c.cs' }] as never;
    expect(reviewedCount({ files, reviewStatus: { 'a.cs': 'passed', 'b.cs': 'inReview' } })).toBe(1);
    expect(reviewedCount(undefined)).toBe(0);
  });
});
