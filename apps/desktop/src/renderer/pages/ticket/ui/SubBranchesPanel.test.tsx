import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { BranchStatus, SubBranchStatus } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { ticketFromRecord, useMergeSubBranches } from '@/entities/agent-ticket';
import { createBranchStatusEventHandlers } from '@/shared/api';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { subBranchRows } from '../lib/sub-branch-rows';
import { SubBranchesPanel } from './TicketPanels';

function sub(name: string, fields: Partial<SubBranchStatus> = {}): SubBranchStatus {
  return {
    name,
    branch: `sub/71273-${name}`,
    worktreePath: `C:/wt/71273--${name}`,
    present: true,
    dirty: false,
    changedFiles: 0,
    conflicted: false,
    ahead: 4,
    behind: 0,
    finished: true,
    ready: true,
    mergedAt: null,
    ...fields,
  };
}

function status(subBranches: SubBranchStatus[]): BranchStatus {
  return {
    ticketId: '71273',
    checkedAt: 1,
    ticket: {
      worktreePath: 'C:/wt/71273',
      present: true,
      dirty: false,
      changedFiles: 0,
      conflicted: false,
      branch: '71273-cutover-job-control',
      baseBranch: 'main',
      baseRef: 'main',
      ahead: 2,
      behind: 0,
    },
    subBranches,
  };
}

const record = fakeTicketRecord({
  id: '71273',
  branch: '71273-cutover-job-control',
  subBranches: [
    { name: 'filter', branch: 'sub/71273-filter', worktreePath: 'C:/wt/71273--filter', createdAt: 1, mergedAt: null },
    { name: 'grid', branch: 'sub/71273-grid', worktreePath: 'C:/wt/71273--grid', createdAt: 2, mergedAt: null },
  ],
});

/** The panel beside a Merge sub-branches button, as on the drill-in. */
function Harness() {
  const merge = useMergeSubBranches();
  return (
    <>
      <SubBranchesPanel ticket={ticketFromRecord(record)} subBranches={record.subBranches} />
      <button type="button" onClick={() => merge.mutate({ ticketId: '71273' })}>
        merge
      </button>
    </>
  );
}

function setup(first: BranchStatus) {
  installFakeBridge({ 'branches:status': { ok: true, data: first } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  return client;
}

const row = (branch: string) => screen.getByTestId(`sub-branch-${branch}`);

describe('SubBranchesPanel (AL-178)', () => {
  it('lists each sub-branch with "N ahead" and Ready, under the target branch', async () => {
    setup(status([sub('filter'), sub('grid', { ahead: 7 })]));
    await waitFor(() => expect(within(row('sub/71273-grid')).getByText('7 ahead')).toBeTruthy());
    expect(within(row('sub/71273-filter')).getByText('4 ahead')).toBeTruthy();
    expect(within(row('sub/71273-filter')).getByText('Ready')).toBeTruthy();
    expect(screen.getByText('→ 71273-cutover-job-control')).toBeTruthy();
  });

  it('refreshes after a merge', async () => {
    setup(status([sub('filter'), sub('grid')]));
    await waitFor(() => expect(within(row('sub/71273-filter')).getByText('Ready')).toBeTruthy());

    installFakeBridge({
      'git:mergeSubBranches': {
        ok: true,
        data: {
          ticketId: '71273',
          target: '71273-cutover-job-control',
          merged: [
            { name: 'filter', branch: 'sub/71273-filter', commit: 'a' },
            { name: 'grid', branch: 'sub/71273-grid', commit: 'b' },
          ],
          skipped: [],
        },
      },
      'branches:status': { ok: true, data: status([sub('filter', { ahead: 0, mergedAt: 5 }), sub('grid', { ahead: 0, mergedAt: 5 })]) },
    });
    fireEvent.click(screen.getByRole('button', { name: 'merge' }));
    await waitFor(() => expect(within(row('sub/71273-filter')).getByText('Merged')).toBeTruthy());
    expect(within(row('sub/71273-grid')).getByText('Merged')).toBeTruthy();
    expect(within(row('sub/71273-grid')).queryByText(/ahead/)).toBeNull();
  });

  it('refreshes when a sub-agent finishes', async () => {
    const client = setup(status([sub('filter', { finished: false, ready: false, ahead: 1 })]));
    await waitFor(() => expect(within(row('sub/71273-filter')).getByText('Working')).toBeTruthy());

    installFakeBridge({ 'branches:status': { ok: true, data: status([sub('filter', { ahead: 3 })]) } });
    const handlers = createBranchStatusEventHandlers(client);
    act(() =>
      handlers['agent:subagent']?.({
        ticketId: '71273',
        at: 9,
        change: 'finished',
        node: {
          id: 'filter',
          taskId: 't1',
          parentId: null,
          name: 'filter',
          agentType: null,
          description: '',
          model: null,
          effort: null,
          status: 'done',
          activity: null,
          tokens: null,
          branch: 'sub/71273-filter',
          readOnly: false,
          startedAt: 1,
          endedAt: 9,
        },
        counts: { running: 0, done: 1, queued: 0, failed: 0 },
      }),
    );
    await waitFor(() => expect(within(row('sub/71273-filter')).getByText('Ready')).toBeTruthy());
    expect(within(row('sub/71273-filter')).getByText('3 ahead')).toBeTruthy();
  });
});

describe('subBranchRows (AL-178)', () => {
  it('lists the record until the status arrives', () => {
    expect(subBranchRows(undefined, [{ name: 'a', branch: 'sub/1-a', worktreePath: 'x', createdAt: 1, mergedAt: 2 }])).toEqual([
      { branch: 'sub/1-a', ahead: null, state: { label: 'Merged', tone: 'ok' } },
    ]);
  });

  it('says why a sub-branch is not ready', () => {
    const labels = subBranchRows(
      [
        sub('a', { present: false, ready: false }),
        sub('b', { conflicted: true, ready: false }),
        sub('c', { dirty: true, ready: false }),
        sub('d', { ahead: 0 }),
      ],
      [],
    ).map((r) => r.state?.label);
    expect(labels).toEqual(['Missing', 'Conflict', 'Uncommitted', 'Nothing new']);
  });
});
