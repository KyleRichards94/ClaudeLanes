import type { BranchStatus, SubBranchStatus } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { mergeErrorInfo } from './conflict';
import { mergePanel } from './merge-panel';

const ticket = { branch: '71273-cutover-job-control', baseBranch: 'main', stage: 'implementing' } as const;

function sub(name: string, fields: Partial<SubBranchStatus> = {}): SubBranchStatus {
  return {
    name,
    branch: `sub/71273-${name}`,
    worktreePath: `C:/wt/71273--${name}`,
    present: true,
    dirty: false,
    changedFiles: 0,
    conflicted: false,
    ahead: 2,
    behind: 0,
    finished: true,
    ready: true,
    mergedAt: null,
    ...fields,
  };
}

function status(fields: Partial<BranchStatus['ticket']> = {}, subBranches: SubBranchStatus[] = [sub('filter'), sub('grid'), sub('tests')]) {
  return {
    status: 'success' as const,
    data: {
      ticketId: '71273',
      checkedAt: 1,
      ticket: {
        worktreePath: 'C:/wt/71273',
        present: true,
        dirty: false,
        changedFiles: 0,
        conflicted: false,
        branch: ticket.branch,
        baseBranch: 'main',
        baseRef: 'main',
        ahead: 4,
        behind: 0,
        ...fields,
      },
      subBranches,
    },
  };
}

describe('mergePanel (AL-174)', () => {
  it('reads "Merge 3 sub-branches → <ticket branch>" and "Merge worktree → main", both on, when ready', () => {
    expect(mergePanel(ticket, status())).toEqual({
      subBranches: { label: 'Merge 3 sub-branches', disabledReason: null },
      toMain: { label: 'Merge worktree → main', disabledReason: null },
      conflicted: false,
      readyCount: 3,
    });
  });

  it('turns both off with the reason while the worktree is dirty', () => {
    const view = mergePanel(ticket, status({ dirty: true, changedFiles: 2 }));
    expect(view.subBranches.disabledReason).toBe('The worktree has 2 uncommitted changes.');
    expect(view.toMain.disabledReason).toBe('The worktree has 2 uncommitted changes.');
  });

  it('turns Merge sub-branches off when nothing is ready, saying why', () => {
    expect(mergePanel(ticket, status({}, [])).subBranches.disabledReason).toBe('No sub-branches yet.');
    expect(mergePanel(ticket, status({}, [sub('grid', { ready: false, finished: false })])).subBranches).toEqual({
      label: 'Merge 1 sub-branch',
      disabledReason: '1 sub-agent still runs.',
    });
    expect(mergePanel(ticket, status({}, [sub('grid', { mergedAt: 5, ahead: 0 })])).subBranches.disabledReason).toBe('Every sub-branch is merged.');
    expect(mergePanel(ticket, status({}, [sub('grid', { ready: false, dirty: true })])).subBranches.disabledReason).toBe(
      '1 sub-branch has uncommitted changes.',
    );
    expect(mergePanel(ticket, status({}, [sub('grid', { ahead: 0 })])).subBranches.disabledReason).toBe('Nothing new on the sub-branches.');
  });

  it('counts only the ready sub-branches when some are', () => {
    const view = mergePanel(ticket, status({}, [sub('grid'), sub('tests', { ready: false, finished: false })]));
    expect(view.subBranches.label).toBe('Merge 1 sub-branch');
    expect(view.subBranches.disabledReason).toBeNull();
  });

  it('holds Merge worktree → main while the agent is mid-turn, and labels an empty sub-branch list plainly (AL-254)', () => {
    const busy = mergePanel(ticket, status({}, [sub('grid')]), { agentBusy: true });
    expect(busy.toMain.disabledReason).toBe('The agent is mid-turn. Wait for it to finish, or stop it first.');
    expect(busy.subBranches.disabledReason).toBeNull();
    expect(mergePanel(ticket, status({}, [])).subBranches.label).toBe('Merge sub-branches');
  });

  it('turns Merge worktree → main off when the ticket branch has nothing new', () => {
    expect(mergePanel(ticket, status({ ahead: 0 })).toMain.disabledReason).toBe('No commits to merge into main yet.');
    expect(mergePanel(ticket, status({ ahead: null })).toMain.disabledReason).toBe('71273-cutover-job-control or main is missing.');
  });

  it('reports a stopped merge and keeps both off until it is resolved', () => {
    const view = mergePanel(ticket, status({ conflicted: true }));
    expect(view.conflicted).toBe(true);
    expect(view.subBranches.disabledReason).toBe('A merge is stopped on conflicts.');
    expect(view.toMain.disabledReason).toBe('A merge is stopped on conflicts.');
  });

  it('is off while the status loads, when it fails, when the worktree is missing and when the ticket is done', () => {
    expect(mergePanel(ticket, { status: 'pending' }).toMain.disabledReason).toBe('Checking the branches…');
    expect(mergePanel(ticket, { status: 'error' }).subBranches.disabledReason).toBe("Couldn't read the branches.");
    expect(mergePanel(ticket, status({ present: false, dirty: null })).toMain.disabledReason).toBe('The worktree is missing.');
    expect(mergePanel({ ...ticket, stage: 'done' }, status()).toMain.disabledReason).toBe('The ticket is done.');
  });
});

describe('mergeErrorInfo (AL-174)', () => {
  it('reads a MERGE_CONFLICT error', () => {
    const error = Object.assign(new Error('Merging sub/71273-footer conflicts.'), {
      code: 'MERGE_CONFLICT',
      details: { reason: 'conflict', branch: 'sub/71273-footer', files: ['JobControl.razor'], merged: [{ branch: 'sub/71273-grid' }] },
    });
    expect(mergeErrorInfo(error)).toEqual({
      code: 'MERGE_CONFLICT',
      message: 'Merging sub/71273-footer conflicts.',
      reason: 'conflict',
      branch: 'sub/71273-footer',
      files: ['JobControl.razor'],
      merged: ['sub/71273-grid'],
    });
  });

  it('tolerates missing or odd details', () => {
    expect(mergeErrorInfo(new Error('boom'))).toMatchObject({ code: 'INTERNAL', reason: null, branch: null, files: [], merged: [] });
    expect(mergeErrorInfo({ code: 'GIT_DIRTY', message: 'dirty', details: { files: ['a.cs', 3] } })).toMatchObject({ files: ['a.cs'] });
  });
});
