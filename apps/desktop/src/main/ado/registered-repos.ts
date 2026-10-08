import { normalizeOrgUrl, parseAdoGitRemote, type AdoGitRemote } from '@agent-lanes/ado-client';
import type { PullRequestRepository, RepoSettings } from '@agent-lanes/contracts';
import type { GitRunner } from '../git';

/**
 * Which Azure Repos repositories are registered in Agent Lanes (AL-232, TB§7 "Add repo"): each
 * registered repo's `origin` remote, read from git and parsed as an Azure Repos URL. A repo without an
 * origin, or whose origin isn't on Azure DevOps, is left out. Never throws.
 */
export async function readRegisteredRemotes(repos: readonly RepoSettings[], git: GitRunner): Promise<AdoGitRemote[]> {
  const remotes = await Promise.all(
    repos.map(async (repo) => {
      try {
        const origin = await git(['config', '--get', 'remote.origin.url'], { cwd: repo.path, allowedExitCodes: [1], timeoutMs: 10_000 });
        if (origin.exitCode !== 0) return null;
        const parsed = parseAdoGitRemote(origin.stdout.trim());
        return parsed.ok ? parsed.data : null;
      } catch {
        return null;
      }
    }),
  );
  return remotes.filter((remote): remote is AdoGitRemote => remote !== null);
}

/** True when a pull request's repository is one of `remotes` in the organisation at `orgUrl`. */
export function isRegisteredRepository(remotes: readonly AdoGitRemote[], orgUrl: string, repository: PullRequestRepository): boolean {
  const org = normalized(orgUrl);
  return remotes.some(
    (remote) =>
      normalized(remote.orgUrl) === org &&
      same(remote.repository, repository.name) &&
      (same(remote.project, repository.projectName) || same(remote.project, repository.projectId)),
  );
}

function normalized(url: string): string {
  const result = normalizeOrgUrl(url);
  return (result.ok ? result.data : url).toLowerCase();
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}
