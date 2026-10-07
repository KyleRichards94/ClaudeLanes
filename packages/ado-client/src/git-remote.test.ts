import { describe, expect, it } from 'vitest';
import { parseAdoGitRemote } from './git-remote';
import { FAKE_PAT } from './testing/msw-server';

describe('parseAdoGitRemote', () => {
  it.each([
    ['dev.azure.com', 'https://dev.azure.com/contoso/Onsite%20Companion/_git/OnSite', 'https://dev.azure.com/contoso', 'Onsite Companion', 'OnSite'],
    ['dev.azure.com with a user name', 'https://contoso@dev.azure.com/contoso/Onsite%20Companion/_git/OnSite', 'https://dev.azure.com/contoso', 'Onsite Companion', 'OnSite'],
    ['dev.azure.com without a project', 'https://dev.azure.com/contoso/_git/OnSite', 'https://dev.azure.com/contoso', 'OnSite', 'OnSite'],
    ['dev.azure.com with a trailing slash', 'https://dev.azure.com/contoso/Web/_git/Portal/', 'https://dev.azure.com/contoso', 'Web', 'Portal'],
    ['a _full clone URL', 'https://dev.azure.com/contoso/Web/_git/_full/Portal', 'https://dev.azure.com/contoso', 'Web', 'Portal'],
    ['visualstudio.com', 'https://Contoso.VisualStudio.com/Web/_git/Portal', 'https://contoso.visualstudio.com', 'Web', 'Portal'],
    ['visualstudio.com with DefaultCollection', 'https://contoso.visualstudio.com/DefaultCollection/Web/_git/Portal', 'https://contoso.visualstudio.com', 'Web', 'Portal'],
    ['visualstudio.com without a project', 'https://contoso.visualstudio.com/_git/Portal', 'https://contoso.visualstudio.com', 'Portal', 'Portal'],
    ['SSH to dev.azure.com', 'git@ssh.dev.azure.com:v3/contoso/Onsite%20Companion/OnSite', 'https://dev.azure.com/contoso', 'Onsite Companion', 'OnSite'],
    ['SSH URL form', 'ssh://git@ssh.dev.azure.com/v3/contoso/Web/Portal', 'https://dev.azure.com/contoso', 'Web', 'Portal'],
    ['SSH to visualstudio.com', 'contoso@vs-ssh.visualstudio.com:v3/contoso/Web/Portal', 'https://contoso.visualstudio.com', 'Web', 'Portal'],
    ['Azure DevOps Server under /tfs', 'https://ado.example.com/tfs/DefaultCollection/Web/_git/Portal', 'https://ado.example.com/tfs/DefaultCollection', 'Web', 'Portal'],
    ['Azure DevOps Server at the root', 'https://ado.example.com/Main/Web/_git/Portal', 'https://ado.example.com/Main', 'Web', 'Portal'],
    ['Azure DevOps Server over plain http', 'http://devops:8090/CompanionSystems/OnSite/_git/OnSite', 'http://devops:8090/CompanionSystems', 'OnSite', 'OnSite'],
  ])('reads %s', (_case, remote, orgUrl, project, repository) => {
    expect(parseAdoGitRemote(remote)).toEqual({ ok: true, data: { orgUrl, project, repository } });
  });

  it.each([
    ['GitHub', 'https://github.com/KyleRichards94/ClaudeLanes.git'],
    ['GitHub over SSH', 'git@github.com:KyleRichards94/ClaudeLanes.git'],
    ['a local path', 'C:/src/onsite'],
    ['a file URL', 'file:///C:/src/onsite/_git/repo'],
    ['nothing after _git', 'https://dev.azure.com/contoso/Web/_git/'],
    ['extra path after the repo', 'https://dev.azure.com/contoso/Web/_git/Portal/pullrequest/5'],
    ['too many segments on dev.azure.com', 'https://dev.azure.com/contoso/Web/extra/_git/Portal'],
    ['plain http to Azure DevOps Services', 'http://dev.azure.com/contoso/Web/_git/Portal'],
    ['a server remote without a project', 'https://ado.example.com/Main/_git/Portal'],
    ['a malformed escape', 'https://dev.azure.com/contoso/We%zzb/_git/Portal'],
    ['an empty string', ''],
  ])('refuses %s', (_case, remote) => {
    expect(parseAdoGitRemote(remote)).toMatchObject({ ok: false, code: 'VALIDATION' });
  });

  it('never echoes a token carried in the remote', () => {
    const result = parseAdoGitRemote(`https://user:${FAKE_PAT}@github.com/contoso/repo.git`);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(FAKE_PAT);

    const accepted = parseAdoGitRemote(`https://user:${FAKE_PAT}@dev.azure.com/contoso/Web/_git/Portal`);
    expect(accepted).toEqual({ ok: true, data: { orgUrl: 'https://dev.azure.com/contoso', project: 'Web', repository: 'Portal' } });
  });
});
