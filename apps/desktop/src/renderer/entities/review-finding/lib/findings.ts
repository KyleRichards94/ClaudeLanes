import type { DiffFilesResponse, FindingSeverity, ReviewFinding, ReviewStatus } from '@agent-lanes/contracts';

/** How a file's review status reads (Code City's "inspection" tile, the change map's tooltip). */
export const REVIEW_STATUS_LABELS: Readonly<Record<ReviewStatus, string>> = {
  notReviewed: 'Not reviewed',
  inReview: 'In review',
  passed: 'Passed',
  changesRequested: 'Changes requested',
};

/** A file's findings, in line order (a finding with no line first). */
export function findingsFor(findings: readonly ReviewFinding[] | undefined, filePath: string | null): ReviewFinding[] {
  if (!findings || filePath === null) return [];
  return findings.filter((finding) => finding.filePath === filePath).sort((a, b) => (a.line ?? 0) - (b.line ?? 0) || a.id.localeCompare(b.id));
}

/** Where the review of a file stands; a path with no entry is not reviewed, and so is a response not read yet. */
export function reviewStatusOf(response: Pick<DiffFilesResponse, 'reviewStatus'> | undefined, path: string): ReviewStatus {
  return response?.reviewStatus[path] ?? 'notReviewed';
}

const SEVERITY_ORDER: Readonly<Record<FindingSeverity, number>> = { error: 0, warn: 1, info: 2 };

/** The worst severity among findings, or null when there are none. */
export function worstSeverity(findings: readonly ReviewFinding[]): FindingSeverity | null {
  let worst: FindingSeverity | null = null;
  for (const finding of findings) if (worst === null || SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[worst]) worst = finding.severity;
  return worst;
}

/** How many files the reviewer has finished (passed or changes requested): the Code review stage's progress. */
export function reviewedCount(response: Pick<DiffFilesResponse, 'files' | 'reviewStatus'> | undefined): number {
  if (!response) return 0;
  return response.files.filter((file) => {
    const status = response.reviewStatus[file.path];
    return status === 'passed' || status === 'changesRequested';
  }).length;
}
