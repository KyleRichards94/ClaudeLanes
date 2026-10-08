import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BranchStatus, MergeToMainPreview, SubBranchStatus } from '@agent-lanes/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentTicketStore, selectTicket } from '@/entities/agent-ticket';
import { clearToasts, getToasts } from '@/shared/model';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { MergeControls } from './MergeControls';

const ticket = { id: '71273', branch: '71273-cutover-job-control', baseBranch: 'main', stage: 'qa' } as const;

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

function branchStatus(fields: Partial<BranchStatus['ticket']> = {}, subBranches = [sub('filter'), sub('grid'), sub('tests')]): BranchStatus {
  return {
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
  };
}

function preview(fields: Partial<MergeToMainPreview> = {}): MergeToMainPreview {
  return {
    ticketId: '71273',
    source: ticket.branch,
    target: 'main',
    repo: 'C:/src/onsite-companion',
    qaPassed: true,
    worktree: { worktreePath: 'C:/wt/71273', present: true, dirty: false, changedFiles: 0, conflicted: false },
    ahead: 4,
    alreadyMerged: false,
    ...fields,
  };
}

function setup(replies: Parameters<typeof installFakeBridge>[0]) {
  const bridge = installFakeBridge(replies);
  const store = createAgentTicketStore();
  store.load([fakeTicketRecord({ id: '71273', stage: 'qa' })]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MergeControls ticket={ticket} store={store} />
    </QueryClientProvider>,
  );
  return { bridge, store };
}

const subButton = () => screen.getByTestId('merge-sub-branches');
const mainButton = () => screen.getByTestId('merge-to-main');

afterEach(() => clearToasts());

describe('MergeControls (AL-174)', () => {
  it('shows both merges ready, labelled as on artboard 3', async () => {
    setup({ 'branches:status': { ok: true, data: branchStatus() } });
    await waitFor(() => expect(subButton().getAttribute('aria-disabled')).toBeNull());
    expect(subButton().textContent).toContain('Merge 3 sub-branches → 71273-cutover-job-control');
    expect(mainButton().textContent).toContain('Merge worktree → main');
    expect(mainButton().getAttribute('aria-disabled')).toBeNull();
    expect(screen.queryByTestId('merge-disabled-reasons')).toBeNull();
  });

  it('disables both with the reason when the worktree is dirty', async () => {
    setup({ 'branches:status': { ok: true, data: branchStatus({ dirty: true, changedFiles: 2 }) } });
    await waitFor(() => expect(screen.getByTestId('merge-disabled-reasons').textContent).toBe('The worktree has 2 uncommitted changes.'));
    expect(subButton().getAttribute('aria-disabled')).toBe('true');
    expect(mainButton().getAttribute('aria-disabled')).toBe('true');
  });

  it('disables Merge sub-branches with a reason when nothing is ready', async () => {
    setup({ 'branches:status': { ok: true, data: branchStatus({}, [sub('grid', { ready: false, finished: false })]) } });
    await waitFor(() => expect(screen.getByTestId('merge-disabled-reasons').textContent).toBe('1 sub-agent still runs.'));
    expect(subButton().getAttribute('aria-disabled')).toBe('true');
    expect(mainButton().getAttribute('aria-disabled')).toBeNull();
  });

  it('merges the ready sub-branches and says what landed', async () => {
    const { bridge } = setup({
      'branches:status': { ok: true, data: branchStatus() },
      'git:mergeSubBranches': {
        ok: true,
        data: {
          ticketId: '71273',
          target: ticket.branch,
          merged: [
            { name: 'filter', branch: 'sub/71273-filter', commit: 'a1' },
            { name: 'grid', branch: 'sub/71273-grid', commit: 'b2' },
          ],
          skipped: [{ name: 'tests', branch: 'sub/71273-tests', reason: 'not-ready' }],
        },
      },
    });
    await waitFor(() => expect(subButton().getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(subButton());
    await waitFor(() => expect(getToasts()).toHaveLength(1));
    expect(bridge.invoke).toHaveBeenCalledWith('git:mergeSubBranches', { ticketId: '71273' });
    expect(getToasts()[0]).toMatchObject({ tone: 'success', title: 'Merged 2 sub-branches into 71273-cutover-job-control' });
  });

  it('opens the conflict view on MERGE_CONFLICT, with Hand to lead agent and Open in editor', async () => {
    const { bridge } = setup({
      'branches:status': { ok: true, data: branchStatus() },
      'git:mergeSubBranches': {
        ok: false,
        code: 'MERGE_CONFLICT',
        message: 'Merging sub/71273-tests into 71273-cutover-job-control conflicts.',
        details: { reason: 'conflict', branch: 'sub/71273-tests', files: ['JobControl.razor', 'JobFilter.cs'], merged: [{ branch: 'sub/71273-filter' }] },
      },
      'git:handConflictToLead': { ok: true, data: { files: ['JobControl.razor', 'JobFilter.cs'], held: false } },
      'git:openConflictFiles': { ok: true, data: { opened: ['C:/wt/71273/JobControl.razor', 'C:/wt/71273/JobFilter.cs'], fileCount: 2 } },
    });
    await waitFor(() => expect(subButton().getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(subButton());

    const dialog = await screen.findByRole('dialog', { name: 'Merge stopped on a conflict' });
    expect(within(dialog).getByText('sub/71273-tests → 71273-cutover-job-control')).toBeTruthy();
    expect(within(dialog).getByText('Merged first: sub/71273-filter.')).toBeTruthy();
    expect(within(dialog).getByTestId('conflict-files').textContent).toBe('JobControl.razorJobFilter.cs');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Open in editor' }));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('git:openConflictFiles', { ticketId: '71273' }));

    fireEvent.click(within(dialog).getByRole('button', { name: 'Hand to lead agent' }));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('git:handConflictToLead', { ticketId: '71273' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Merge stopped on a conflict' })).toBeNull());
    expect(getToasts().at(-1)).toMatchObject({ tone: 'success', title: 'Handed to the lead agent', body: 'The agent is resolving 2 conflicted files.' });
  });

  it('keeps a stopped merge one press away, listing the worktree’s unmerged files', async () => {
    setup({
      'branches:status': { ok: true, data: branchStatus({ conflicted: true }) },
      'git:diff': {
        ok: true,
        data: {
          ticketId: '71273',
          against: { kind: 'base' },
          fromRef: 'main',
          fromCommit: 'abc',
          toRef: ticket.branch,
          includesUncommitted: true,
          truncated: false,
          totals: { files: 2, additions: 3, deletions: 1 },
          files: [
            { path: 'JobControl.razor', oldPath: null, status: 'unmerged', additions: 2, deletions: 1, binary: false },
            { path: 'Grid.razor', oldPath: null, status: 'added', additions: 1, deletions: 0, binary: false },
          ],
        },
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Merge stopped on conflicts. View conflicts' }));
    const dialog = await screen.findByRole('dialog', { name: 'Merge stopped on a conflict' });
    await waitFor(() => expect(within(dialog).getByTestId('conflict-files').textContent).toBe('JobControl.razor'));
    expect(subButton().getAttribute('aria-disabled')).toBe('true');
  });

  it('asks before merging into main, warns that QA has not passed and merges anyway on confirm', async () => {
    const { bridge, store } = setup({
      'branches:status': { ok: true, data: branchStatus() },
      'git:mergeToMainPreview': { ok: true, data: preview({ qaPassed: false }) },
      'git:mergeToMain': {
        ok: true,
        data: { record: fakeTicketRecord({ id: '71273', stage: 'done' }), target: 'main', mergeCommit: 'm1', pushed: true, mergedAt: new Date(2026, 9, 8, 15, 20).getTime() },
      },
    });
    await waitFor(() => expect(mainButton().getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(mainButton());

    const dialog = await screen.findByRole('dialog', { name: 'Merge worktree → main' });
    await waitFor(() => expect(within(dialog).getByTestId('merge-to-main-qa-warning')).toBeTruthy());
    expect(within(dialog).getByTestId('merge-to-main-summary').textContent).toContain('4 commits on 71273-cutover-job-control merge into main');
    expect(bridge.invoke).not.toHaveBeenCalledWith('git:mergeToMain', expect.anything());

    fireEvent.click(within(dialog).getByRole('button', { name: 'Merge anyway' }));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('git:mergeToMain', { ticketId: '71273', acceptQaWarning: true, confirmed: true }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Merge worktree → main' })).toBeNull());
    expect(getToasts().at(-1)).toMatchObject({ tone: 'success', title: 'Merged into main · 15:20' });
    expect(selectTicket(store.getState(), '71273')?.stage).toBe('done');
  });

  it('Cancel closes the confirm without merging', async () => {
    const { bridge } = setup({ 'branches:status': { ok: true, data: branchStatus() }, 'git:mergeToMainPreview': { ok: true, data: preview() } });
    await waitFor(() => expect(mainButton().getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(mainButton());
    const dialog = await screen.findByRole('dialog', { name: 'Merge worktree → main' });
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Merge into main' }).getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(bridge.invoke).not.toHaveBeenCalledWith('git:mergeToMain', expect.anything());
  });

  it('refuses a dirty worktree in the confirm, from the preview or from the merge', async () => {
    setup({
      'branches:status': { ok: true, data: branchStatus() },
      'git:mergeToMainPreview': { ok: true, data: preview() },
      'git:mergeToMain': {
        ok: false,
        code: 'GIT_DIRTY',
        message: 'The worktree has uncommitted changes.',
        details: { reason: 'worktree-dirty', files: ['Pages/Jobs/JobControl.razor'] },
      },
    });
    await waitFor(() => expect(mainButton().getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(mainButton());
    const dialog = await screen.findByRole('dialog', { name: 'Merge worktree → main' });
    const confirm = () => within(dialog).getByRole('button', { name: 'Merge into main' });
    await waitFor(() => expect(confirm().getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(confirm());

    await waitFor(() => expect(within(dialog).getByTestId('merge-to-main-dirty').textContent).toContain('Pages/Jobs/JobControl.razor'));
    expect(confirm().getAttribute('aria-disabled')).toBe('true');
  });

  it('a preview that finds the worktree dirty never offers the merge', async () => {
    setup({
      'branches:status': { ok: true, data: branchStatus() },
      'git:mergeToMainPreview': { ok: true, data: preview({ worktree: { worktreePath: 'C:/wt/71273', present: true, dirty: true, changedFiles: 3, conflicted: false } }) },
    });
    await waitFor(() => expect(mainButton().getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(mainButton());
    const dialog = await screen.findByRole('dialog', { name: 'Merge worktree → main' });
    await waitFor(() => expect(within(dialog).getByTestId('merge-to-main-dirty').textContent).toContain('Commit or discard 3 changes before merging.'));
    expect(within(dialog).getByRole('button', { name: 'Merge into main' }).getAttribute('aria-disabled')).toBe('true');
  });
});
