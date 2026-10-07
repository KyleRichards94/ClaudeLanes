import type { GitService, GitVersionCheck } from './git-service';
import { GIT_DOWNLOAD_URL, formatMinimumGitVersion } from './git-version';

/** What the start-up warning shows when git is missing or too old (AL-080). */
export interface GitStartupNotice {
  title: string;
  message: string;
  detail: string;
  downloadUrl: string;
}

export function gitStartupNotice(check: GitVersionCheck): GitStartupNotice | null {
  if (check.ok) return null;
  return {
    title: check.reason === 'not-found' ? 'Git not found' : `Git ${formatMinimumGitVersion()} or later needed`,
    message: check.message,
    detail:
      'You can still browse work items, but creating worktrees, branches and merges will fail until Git is installed or updated.',
    downloadUrl: GIT_DOWNLOAD_URL,
  };
}

/**
 * Checks the git version once at start-up and, when it is missing or too old, hands the notice to
 * `notify` (the main process shows a native dialog). Never throws; resolves with the check.
 */
export async function checkGitOnStartup(
  git: Pick<GitService, 'checkVersion'>,
  notify: (notice: GitStartupNotice) => void | Promise<void>,
  log: (line: string) => void = (line) => console.warn(`[git] ${line}`),
): Promise<GitVersionCheck> {
  const check = await git.checkVersion();
  const notice = gitStartupNotice(check);
  if (notice) {
    log(notice.message);
    try {
      await notify(notice);
    } catch (error) {
      log(`Could not show the git warning: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return check;
}
