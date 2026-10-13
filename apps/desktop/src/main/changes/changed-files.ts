import type { ChangeKind, ChangedFile, DiffFile } from '@agent-lanes/contracts';
import { attributionOf, type AttributionMap } from '../agent/attribution/attribution';
import type { GitStatus } from '../git/porcelain';

/** `git:diff`'s row → `diff:files`' (AL-276): git's richer statuses fold into the five kinds the layouts draw. */
const KINDS: Record<DiffFile['status'], ChangeKind> = {
  added: 'added',
  untracked: 'added',
  copied: 'added',
  modified: 'modified',
  'type-changed': 'modified',
  unmerged: 'modified',
  deleted: 'deleted',
  renamed: 'renamed',
};

/** Paths `git status` lists in the worktree (staged, unstaged, unmerged or untracked; not ignored): changes that are not committed yet. */
export function uncommittedPaths(status: GitStatus): Set<string> {
  return new Set(status.entries.filter((entry) => entry.kind !== 'ignored').map((entry) => entry.path));
}

/**
 * The ticket's files from `git:diff`, with each file's author and whether it is uncommitted, merged by
 * path. Committed and working-tree changes are already one row per path in `git:diff`; a file with no
 * recorded tool call (you edited it, or a merge brought it in) has no author.
 */
export function toChangedFiles(files: readonly DiffFile[], attribution: AttributionMap, uncommitted: ReadonlySet<string>): ChangedFile[] {
  const folded = new Set([...uncommitted].map((path) => path.toLowerCase()));
  return files.map((file) => {
    const kind: ChangeKind = file.binary ? 'binary' : KINDS[file.status];
    const { authorAgentId, touchedBy } = attributionOf(attribution, file.path, kind === 'renamed' ? file.oldPath : null);
    return {
      path: file.path,
      oldPath: kind === 'renamed' ? file.oldPath : null,
      kind,
      added: file.binary ? 0 : (file.additions ?? 0),
      removed: file.binary ? 0 : (file.deletions ?? 0),
      authorAgentId,
      touchedBy,
      uncommitted: file.status === 'untracked' || uncommitted.has(file.path) || folded.has(file.path.toLowerCase()),
    };
  });
}
