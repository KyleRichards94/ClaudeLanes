export { DIFF_FILES_REFRESH_MS, cancelDiffFilesRefreshes, diffFilesQueryKey, requestDiffFilesRefresh, useDiffFiles } from './api/diff-files';
export {
  UNKNOWN_AUTHOR_NAME,
  authorOf,
  changeTotals,
  coAuthorsOf,
  linesChanged,
  sortedByChange,
  type AuthorAgent,
  type ChangeTotals,
  type FileAuthor,
} from './lib/changes';
export { diffStats, diffStatus, fileCount, formatBytes, parseUnifiedDiff, toSplitRows, type DiffLine, type SplitRow } from './lib/diff-lines';
export { AUTHOR_STRIPE_WIDTH, DIFF_LINES_PAGE, FileDiff, type FileDiffProps } from './ui/FileDiff';
export type { ChangeKind, ChangedFile, DiffFilesResponse, ReviewStatus } from '@agent-lanes/contracts';
