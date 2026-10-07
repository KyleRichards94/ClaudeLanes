import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { GitDiff } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { installFakeBridge } from '@/shared/testing';
import { branchesQueryKey } from './branches';
import { diffFileQueryKey, diffQueryKey, useDiffFile, useTicketDiff } from './diff';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}

const diff: GitDiff = {
  ticketId: '71273',
  against: { kind: 'base' },
  fromRef: 'main',
  fromCommit: 'abc',
  toRef: '71273-cutover',
  includesUncommitted: true,
  files: [{ path: 'logo.png', oldPath: null, status: 'modified', additions: null, deletions: null, binary: true }],
  truncated: false,
  totals: { files: 1, additions: 0, deletions: 0 },
};

describe('diff queries', () => {
  it('loads the file list against the base under the ticket branch status key', async () => {
    const bridge = installFakeBridge({ 'git:diff': { ok: true, data: diff } });
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useTicketDiff('71273', { kind: 'base' }), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(diff));
    expect(bridge.invoke).toHaveBeenCalledWith('git:diff', { ticketId: '71273', against: { kind: 'base' } });
    await client.invalidateQueries({ queryKey: branchesQueryKey('71273'), refetchType: 'none' });
    expect(client.getQueryState(diffQueryKey('71273', { kind: 'base' }))?.isInvalidated).toBe(true);
  });

  it('loads one file only once it is opened, and keeps sub-branch diffs apart', async () => {
    const bridge = installFakeBridge({ 'git:diffFile': { ok: true, data: { kind: 'binary', path: 'logo.png' } } });
    const { wrapper } = setup();
    const against = { kind: 'sub-branch', branch: 'sub/71273-grid' } as const;
    const { result, rerender } = renderHook(({ file }: { file: { path: string } | null }) => useDiffFile('71273', against, file), {
      wrapper,
      initialProps: { file: null as { path: string } | null },
    });
    expect(bridge.invoke).not.toHaveBeenCalled();

    rerender({ file: { path: 'logo.png' } });

    await waitFor(() => expect(result.current.data).toEqual({ kind: 'binary', path: 'logo.png' }));
    expect(bridge.invoke).toHaveBeenCalledWith('git:diffFile', { ticketId: '71273', against, path: 'logo.png' });
    expect(diffFileQueryKey('71273', against, 'logo.png')).not.toEqual(diffFileQueryKey('71273', { kind: 'base' }, 'logo.png'));
  });
});
