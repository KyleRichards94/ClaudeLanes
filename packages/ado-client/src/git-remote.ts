import { err, ok, type Result } from '@agent-lanes/contracts';
import { normalizeOrgUrl } from './org-url';

/** Where an Azure Repos git remote points: what `createPullRequest` needs besides the branches. */
export interface AdoGitRemote {
  /** Normalised organisation (or collection) URL, the key the Connections service stores PATs under. */
  orgUrl: string;
  project: string;
  repository: string;
}

const SSH_REMOTE = /^(?:ssh:\/\/)?[^@\s/]+@(ssh\.dev\.azure\.com|vs-ssh\.visualstudio\.com)(?::22)?[:/]v3\/([^/\s]+)\/([^/\s]+)\/([^/\s]+?)\/?$/i;
/** Segments ADO may put between `_git` and the repository name in clone URLs. */
const CLONE_VARIANTS = new Set(['_optimized', '_full']);

/**
 * Reads the organisation, project and repository from an Azure Repos remote (`git remote get-url
 * origin`), so the Create PR stage knows where to open the pull request (AL-064):
 *
 * - `https://[user@]dev.azure.com/{org}/{project}/_git/{repo}`
 * - `https://{org}.visualstudio.com/[DefaultCollection/]{project}/_git/{repo}`
 * - `git@ssh.dev.azure.com:v3/{org}/{project}/{repo}`, `{org}@vs-ssh.visualstudio.com:v3/{org}/{project}/{repo}`
 * - Azure DevOps Server: `https://{server}/[tfs/]{collection}/{project}/_git/{repo}`
 *
 * A remote without a project (`…/_git/{repo}`) names a repository in the project of the same name.
 * Errors never echo the remote: it may carry a user name or a token.
 */
export function parseAdoGitRemote(remote: string): Result<AdoGitRemote> {
  const input = typeof remote === 'string' ? remote.trim() : '';
  const ssh = SSH_REMOTE.exec(input);
  if (ssh) {
    const [, host = '', org = '', project = '', repository = ''] = ssh;
    const orgUrl = host.toLowerCase() === 'ssh.dev.azure.com' ? `https://dev.azure.com/${org}` : `https://${org}.visualstudio.com`;
    return build(orgUrl, project, repository);
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return notAzureRepos();
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return notAzureRepos();

  const segments = url.pathname.split('/').filter(Boolean);
  const gitIndex = segments.findIndex((segment) => segment.toLowerCase() === '_git');
  if (gitIndex < 0) return notAzureRepos();
  let repoIndex = gitIndex + 1;
  if (CLONE_VARIANTS.has(segments[repoIndex]?.toLowerCase() ?? '')) repoIndex += 1;
  const repository = segments[repoIndex];
  if (repository === undefined || repoIndex !== segments.length - 1) return notAzureRepos();

  const before = segments.slice(0, gitIndex);
  const host = url.hostname.toLowerCase();
  const origin = `${url.protocol}//${url.host}`;

  if (host === 'dev.azure.com') {
    const [org, project, ...rest] = before;
    if (org === undefined || rest.length > 0) return notAzureRepos();
    return build(`${origin}/${org}`, project ?? repository, repository);
  }
  if (host.endsWith('.visualstudio.com')) {
    const path = before[0]?.toLowerCase() === 'defaultcollection' ? before.slice(1) : before;
    const [project, ...rest] = path;
    if (rest.length > 0) return notAzureRepos();
    return build(origin, project ?? repository, repository);
  }
  // Azure DevOps Server: the collection path is everything before the project.
  const project = before.at(-1);
  const collection = before.slice(0, -1);
  if (project === undefined || collection.length === 0) {
    return err('VALIDATION', 'The git remote has no project in its path; Azure DevOps Server remotes need …/{collection}/{project}/_git/{repo}.');
  }
  return build(`${origin}/${collection.join('/')}`, project, repository);
}

function build(orgUrl: string, project: string, repository: string): Result<AdoGitRemote> {
  const org = normalizeOrgUrl(orgUrl);
  if (!org.ok) return org;
  const decodedProject = decode(project);
  const decodedRepository = decode(repository);
  if (!decodedProject || !decodedRepository) return notAzureRepos();
  return ok({ orgUrl: org.data, project: decodedProject, repository: decodedRepository });
}

function decode(segment: string): string | null {
  try {
    const value = decodeURIComponent(segment).trim();
    return value === '' ? null : value;
  } catch {
    return null;
  }
}

function notAzureRepos() {
  return err('VALIDATION', 'The git remote is not an Azure Repos URL (…/{project}/_git/{repo} or git@ssh.dev.azure.com:v3/…).');
}
