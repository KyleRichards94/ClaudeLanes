import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { GitDiff, GitDiffFile, GitDiffFileRequest, GitDiffRequest, TicketSubBranch } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { installFakeBridge } from '@/shared/testing';
import { DIFF_LINES_PAGE, DiffTab } from './DiffTab';

vi.setConfig({ testTimeout: 30_000 });

const files: GitDiff['files'] = [
  { path: 'Pages/Jobs/JobControl.razor', oldPath: null, status: 'added', additions: 214, deletions: 0, binary: false },
  { path: 'OnSite/Forms/frmJobControl.vb', oldPath: null, status: 'modified', additions: 3, deletions: 8, binary: false },
  { path: 'wwwroot/logo.png', oldPath: null, status: 'modified', additions: null, deletions: null, binary: true },
  { path: 'Data/seed.json', oldPath: 'Data/old-seed.json', status: 'renamed', additions: 1, deletions: 1, binary: false },
];

function diffOf(request: GitDiffRequest, overrides: Partial<GitDiff> = {}): GitDiff {
  return {
    ticketId: request.ticketId,
    against: request.against,
    fromRef: request.against.kind === 'base' ? 'main' : '71273-cutover-job-control',
    fromCommit: 'abcdef0123456',
    toRef: request.against.kind === 'base' ? '71273-cutover-job-control' : request.against.branch,
    includesUncommitted: true,
    files,
    truncated: false,
    totals: { files: files.length, additions: 218, deletions: 9 },
    ...overrides,
  };
}

const smallPatch = '@@ -1,2 +1,2 @@\n Imports System\n-Public Class frmJobControl\n+Public Class frmJobControlLegacy\n';

function fileReply(request: GitDiffFileRequest): GitDiffFile {
  if (request.path === 'wwwroot/logo.png') return { kind: 'binary', path: request.path };
  if (request.path === 'Pages/Jobs/JobControl.razor') {
    const body = Array.from({ length: 1_000 }, (_, i) => `+line ${i}`).join('\n');
    return { kind: 'text', path: request.path, patch: `@@ -0,0 +1,1000 @@\n${body}\n` };
  }
  if (request.path === 'Data/seed.json') return { kind: 'too-large', path: request.path, bytes: 2 * 1024 * 1024, limit: 256 * 1024 };
  return { kind: 'text', path: request.path, patch: smallPatch };
}

function setup({ subBranches = [], diff }: { subBranches?: TicketSubBranch[]; diff?: Partial<GitDiff> } = {}) {
  const bridge = installFakeBridge();
  bridge.invoke = vi.fn(async (channel: string, request: unknown) => {
    if (channel === 'git:diff') return { ok: true, data: diffOf(request as GitDiffRequest, diff) };
    if (channel === 'git:diffFile') return { ok: true, data: fileReply(request as GitDiffFileRequest) };
    return { ok: false, code: 'INTERNAL', message: 'no fake reply' };
  }) as typeof bridge.invoke;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DiffTab ticketId="71273" branch="71273-cutover-job-control" subBranches={subBranches} />
    </QueryClientProvider>,
  );
  const fileCalls = () => vi.mocked(bridge.invoke).mock.calls.filter(([channel]) => channel === 'git:diffFile');
  return { bridge, fileCalls };
}

describe('DiffTab (AL-179)', () => {
  it('lists the changed files with their stats and loads no file diff until one is opened', async () => {
    const { fileCalls } = setup();

    expect(await screen.findAllByTestId('diff-file')).toHaveLength(4);
    expect(screen.getByTestId('diff-totals').textContent).toBe('4 files · +218 −9');
    expect(screen.getByTestId('diff-refs').textContent).toBe('71273-cutover-job-control vs main @ abcdef0');
    expect(screen.getByText('Includes uncommitted changes')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pages/Jobs/JobControl.razor, added, +214 −0' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Data/old-seed.json → Data/seed.json, renamed, +1 −1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'wwwroot/logo.png, modified, binary' })).toBeTruthy();
    expect(fileCalls()).toHaveLength(0);
  });

  it('loads one file on demand and draws it as a unified diff with add and remove tints', async () => {
    const { fileCalls } = setup();
    fireEvent.click(await screen.findByTestId('diff-file-OnSite/Forms/frmJobControl.vb'));

    const lines = await screen.findByTestId('diff-file-lines');
    expect(fileCalls()).toEqual([['git:diffFile', { ticketId: '71273', against: { kind: 'base' }, path: 'OnSite/Forms/frmJobControl.vb' }]]);
    expect(within(lines).getAllByTestId('diff-line-hunk')).toHaveLength(1);
    expect(within(lines).getByTestId('diff-line-remove').textContent).toContain('Public Class frmJobControl');
    expect(within(lines).getByTestId('diff-line-add').textContent).toContain('Public Class frmJobControlLegacy');
    expect(screen.getByTestId('diff-file-OnSite/Forms/frmJobControl.vb').getAttribute('aria-expanded')).toBe('true');

    // Closing and reopening draws the cached diff straight away.
    fireEvent.click(screen.getByTestId('diff-file-OnSite/Forms/frmJobControl.vb'));
    expect(screen.queryByTestId('diff-file-lines')).toBeNull();
    fireEvent.click(screen.getByTestId('diff-file-OnSite/Forms/frmJobControl.vb'));
    expect(screen.getByTestId('diff-file-lines')).toBeTruthy();
    expect(screen.queryByTestId('diff-file-loading')).toBeNull();
  });

  it('draws a long file a page of lines at a time', async () => {
    setup();
    fireEvent.click(await screen.findByTestId('diff-file-Pages/Jobs/JobControl.razor'));
    const lines = await screen.findByTestId('diff-file-lines');
    expect(within(lines).getAllByTestId('diff-line-add')).toHaveLength(DIFF_LINES_PAGE - 1);

    fireEvent.click(screen.getByRole('button', { name: `Show ${DIFF_LINES_PAGE} more of ${1_001 - DIFF_LINES_PAGE} lines` }));
    expect(within(lines).getAllByTestId('diff-line-add')).toHaveLength(2 * DIFF_LINES_PAGE - 1);
  });

  it('shows placeholders, not content, for binary and too-large files', async () => {
    setup();
    fireEvent.click(await screen.findByTestId('diff-file-wwwroot/logo.png'));
    fireEvent.click(screen.getByTestId('diff-file-Data/seed.json'));
    expect((await screen.findByTestId('diff-file-binary')).textContent).toBe('Binary file not shown.');
    expect((await screen.findByTestId('diff-file-too-large')).textContent).toBe('Diff too large to show (2.0 MB). Open the file in your editor to see it.');
  });

  it('compares an unmerged sub-branch with the ticket branch', async () => {
    const subBranches: TicketSubBranch[] = [
      { name: 'grid', branch: 'sub/71273-grid', worktreePath: 'C:\\w\\grid', createdAt: 1, mergedAt: null },
      { name: 'filter', branch: 'sub/71273-filter', worktreePath: 'C:\\w\\filter', createdAt: 1, mergedAt: 5 },
    ];
    const { bridge } = setup({ subBranches });
    await screen.findAllByTestId('diff-file');
    expect(screen.queryByRole('radio', { name: /sub\/71273-filter/ })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'sub/71273-grid vs 71273-cutover-job-control' }));
    await waitFor(() => expect(screen.getByTestId('diff-refs').textContent).toBe('sub/71273-grid vs 71273-cutover-job-control @ abcdef0'));
    expect(bridge.invoke).toHaveBeenCalledWith('git:diff', { ticketId: '71273', against: { kind: 'sub-branch', branch: 'sub/71273-grid' } });
  });

  it('says when there is nothing to show or the list was cut short', async () => {
    setup({ diff: { files: [], totals: { files: 0, additions: 0, deletions: 0 } } });
    expect((await screen.findByTestId('diff-empty')).textContent).toBe('No changes against the base yet.');
  });

  it('says when more files changed than the list holds', async () => {
    setup({ diff: { truncated: true, totals: { files: 2_400, additions: 1, deletions: 1 } } });
    expect((await screen.findByTestId('diff-truncated')).textContent).toBe('Showing the first 4 files of 2400.');
  });
});
