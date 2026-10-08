import type { RepoSettings } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { GitError, type GitRunner } from '../git';
import { isRegisteredRepository, readRegisteredRemotes } from './registered-repos';

function repo(path: string): RepoSettings {
  return { path, name: path, baseBranch: 'main', worktreeRoot: `${path}-wt`, buildCommand: null, runCommand: null, maxConcurrentAgents: 3 };
}

const ORIGINS: Record<string, string | undefined> = {
  'C:/src/onsite': 'https://CompanionSystems@dev.azure.com/CompanionSystems/OnSite%20Companion/_git/onsite-companion\n',
  'C:/src/github': 'https://github.com/example/tool.git\n',
  'C:/src/no-origin': undefined,
};

const git: GitRunner = async (args, { cwd }) => {
  if (cwd === 'C:/src/broken') throw new GitError('GIT_NOT_FOUND', 'git is missing');
  expect(args).toEqual(['config', '--get', 'remote.origin.url']);
  const origin = ORIGINS[cwd];
  return origin === undefined ? { stdout: '', stderr: '', exitCode: 1 } : { stdout: origin, stderr: '', exitCode: 0 };
};

const PR_REPO = { id: 'r1', name: 'onsite-companion', projectId: 'p1', projectName: 'OnSite Companion' };

describe('registered repos (AL-232)', () => {
  it("reads each registered repo's Azure Repos origin and skips the rest", async () => {
    const remotes = await readRegisteredRemotes([repo('C:/src/onsite'), repo('C:/src/github'), repo('C:/src/no-origin'), repo('C:/src/broken')], git);
    expect(remotes).toEqual([{ orgUrl: 'https://dev.azure.com/CompanionSystems', project: 'OnSite Companion', repository: 'onsite-companion' }]);
  });

  it('matches a pull request repository by organisation, project and name, ignoring case', () => {
    const remotes = [{ orgUrl: 'https://dev.azure.com/CompanionSystems', project: 'OnSite Companion', repository: 'onsite-companion' }];
    expect(isRegisteredRepository(remotes, 'https://dev.azure.com/companionsystems/', { ...PR_REPO, name: 'OnSite-Companion' })).toBe(true);
    expect(isRegisteredRepository(remotes, 'https://dev.azure.com/CompanionSystems', { ...PR_REPO, name: 'osc-mobile' })).toBe(false);
    expect(isRegisteredRepository(remotes, 'https://dev.azure.com/contoso', PR_REPO)).toBe(false);
    expect(isRegisteredRepository(remotes, 'https://dev.azure.com/CompanionSystems', { ...PR_REPO, projectName: 'Other' })).toBe(false);
    expect(isRegisteredRepository([], 'https://dev.azure.com/CompanionSystems', PR_REPO)).toBe(false);
  });
});
