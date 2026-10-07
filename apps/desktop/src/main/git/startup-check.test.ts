import { describe, expect, it, vi } from 'vitest';
import type { GitVersionCheck } from './git-service';
import { checkGitOnStartup, gitStartupNotice, type GitStartupNotice } from './startup-check';

const TOO_OLD: GitVersionCheck = {
  ok: false,
  reason: 'too-old',
  version: { major: 2, minor: 30, patch: 1 },
  message:
    'Agent Lanes needs Git 2.38 or later, and this computer has Git 2.30.1. Install the latest Git from https://git-scm.com/downloads, then restart Agent Lanes.',
};

function gitReturning(check: GitVersionCheck) {
  return { checkVersion: vi.fn(async () => check) };
}

describe('checkGitOnStartup', () => {
  it('stays quiet when git is new enough', async () => {
    const notify = vi.fn();
    const log = vi.fn();
    const ok: GitVersionCheck = { ok: true, version: { major: 2, minor: 54, patch: 0 } };

    await expect(checkGitOnStartup(gitReturning(ok), notify, log)).resolves.toBe(ok);
    expect(notify).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
  });

  it('shows one clear notice when git is too old', async () => {
    const notices: GitStartupNotice[] = [];
    const log = vi.fn();

    await checkGitOnStartup(gitReturning(TOO_OLD), (notice) => void notices.push(notice), log);

    expect(notices).toEqual([
      {
        title: 'Git 2.38 or later needed',
        message: TOO_OLD.ok ? '' : TOO_OLD.message,
        detail: expect.stringContaining('creating worktrees, branches and merges will fail'),
        downloadUrl: 'https://git-scm.com/downloads',
      },
    ]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('this computer has Git 2.30.1'));
  });

  it('titles a missing git differently', () => {
    const notice = gitStartupNotice({ ok: false, reason: 'not-found', version: null, message: 'Git was not found.' });
    expect(notice?.title).toBe('Git not found');
  });

  it('never throws, even when the notice cannot be shown', async () => {
    const log = vi.fn();
    const notify = vi.fn(async () => {
      throw new Error('no window');
    });

    await expect(checkGitOnStartup(gitReturning(TOO_OLD), notify, log)).resolves.toBe(TOO_OLD);
    expect(log).toHaveBeenLastCalledWith('Could not show the git warning: no window');
  });
});
