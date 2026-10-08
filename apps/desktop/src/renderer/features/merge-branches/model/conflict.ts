/**
 * What a MERGE_CONFLICT or GIT_DIRTY error says about the merge (AL-086, AL-087): the branch that
 * conflicted, the files, and the sub-branches merged before it. Read defensively, since `details`
 * crosses IPC as `unknown`.
 */
export interface MergeErrorInfo {
  code: string;
  message: string;
  /** `conflict`, `merge-in-progress`, `worktree-dirty`, `qa-not-passed`… */
  reason: string | null;
  /** The sub-branch that conflicted. */
  branch: string | null;
  files: readonly string[];
  /** Sub-branches merged before the conflict. */
  merged: readonly string[];
}

function fields(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function mergeErrorInfo(error: unknown): MergeErrorInfo {
  const source = fields(error);
  const details = fields(source['details']);
  const merged = Array.isArray(details['merged'])
    ? details['merged'].map((entry) => fields(entry)['branch']).filter((branch): branch is string => typeof branch === 'string')
    : [];
  return {
    code: typeof source['code'] === 'string' ? source['code'] : 'INTERNAL',
    message: error instanceof Error ? error.message : typeof source['message'] === 'string' ? source['message'] : 'Something went wrong.',
    reason: typeof details['reason'] === 'string' ? details['reason'] : null,
    branch: typeof details['branch'] === 'string' ? details['branch'] : null,
    files: strings(details['files']),
    merged,
  };
}
