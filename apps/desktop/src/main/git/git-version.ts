/** Git version handling (AL-080): the app needs MIN_GIT_VERSION for `worktree list -z`, `merge-tree --write-tree` and friends. */

export interface GitVersion {
  major: number;
  minor: number;
  patch: number;
}

export const MIN_GIT_VERSION: GitVersion = { major: 2, minor: 38, patch: 0 };

export const GIT_DOWNLOAD_URL = 'https://git-scm.com/downloads';

/**
 * Reads `git --version` output: `git version 2.47.1.windows.1`, `git version 2.39.3 (Apple Git-146)`.
 * Returns null when the text has no version in it.
 */
export function parseGitVersion(output: string): GitVersion | null {
  const match = /git version (\d+)\.(\d+)(?:\.(\d+))?/i.exec(output);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] ?? 0) };
}

/** Negative when `a` is older than `b`, zero when equal, positive when newer. */
export function compareGitVersions(a: GitVersion, b: GitVersion): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

export function formatGitVersion(version: GitVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/** "2.38" style, for messages. */
export function formatMinimumGitVersion(version: GitVersion = MIN_GIT_VERSION): string {
  return version.patch === 0 ? `${version.major}.${version.minor}` : formatGitVersion(version);
}
