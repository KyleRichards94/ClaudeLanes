import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AgentOutputEvent, DiffFilesResponse } from '@agent-lanes/contracts';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noteOutputEvents, resetOutputSettle } from '@/shared/model';
import { installFakeBridge } from '@/shared/testing';
import { DIFF_FILES_REFRESH_MS, cancelDiffFilesRefreshes, diffFilesQueryKey, useDiffFiles } from './diff-files';

const response: DiffFilesResponse = {
  ticketId: '71273',
  base: 'main',
  head: '71273-cutover',
  files: [{ path: 'src/Grid.razor', oldPath: null, kind: 'added', added: 12, removed: 0, authorAgentId: '71273', touchedBy: ['71273'], uncommitted: false }],
  truncated: false,
  reviewStatus: {},
};

let seq = 0;
const toolRow = (rowId: string, tool: 'edit' | 'read'): AgentOutputEvent => ({
  ticketId: '71273',
  at: 1,
  seq: (seq += 1),
  item: { kind: 'tool', rowId, toolUseIds: [rowId], tool, label: tool, detail: 'src/Grid.razor', stats: null, parentToolUseId: null },
});
const toolResult = (rowId: string, isError = false): AgentOutputEvent => ({
  ticketId: '71273',
  at: 2,
  seq: (seq += 1),
  item: { kind: 'tool-result', rowId, toolUseId: rowId, isError, summary: '', stats: null, parentToolUseId: null },
});

function setup() {
  const bridge = installFakeBridge({ 'diff:files': { ok: true, data: response } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const calls = () => vi.mocked(bridge.invoke).mock.calls.filter(([channel]) => channel === 'diff:files').length;
  return { client, wrapper, calls };
}

describe('useDiffFiles (AL-276)', () => {
  beforeEach(() => resetOutputSettle());
  afterEach(() => cancelDiffFilesRefreshes());

  it('reads the changed files under ["diff","files",ticketId]', async () => {
    const { client, wrapper, calls } = setup();
    const { result } = renderHook(() => useDiffFiles('71273'), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(response));
    expect(diffFilesQueryKey('71273')).toEqual(['diff', 'files', '71273']);
    expect(client.getQueryData(['diff', 'files', '71273'])).toEqual(response);
    expect(calls()).toBe(1);
  });

  it('reads again once, a second after a burst of Edit and Write results settles, and not for a Read', async () => {
    const { wrapper, calls } = setup();
    const { result } = renderHook(() => useDiffFiles('71273'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    act(() => noteOutputEvents([toolRow('r', 'read'), toolResult('r')]));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls()).toBe(1);

    act(() => noteOutputEvents([toolRow('a', 'edit'), toolResult('a')]));
    act(() => noteOutputEvents([toolRow('b', 'edit'), toolResult('b')]));
    act(() => noteOutputEvents([toolRow('c', 'edit'), toolResult('c')]));
    // Nothing yet: the refresh waits out the debounce.
    expect(calls()).toBe(1);

    await waitFor(() => expect(calls()).toBe(2), { timeout: DIFF_FILES_REFRESH_MS * 3 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(calls()).toBe(2);
  });

  it('does not read again for output that was already there when the view opened', async () => {
    const { wrapper, calls } = setup();
    act(() => noteOutputEvents([toolRow('a', 'edit'), toolResult('a')]));
    const { result } = renderHook(() => useDiffFiles('71273'), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    await new Promise((resolve) => setTimeout(resolve, DIFF_FILES_REFRESH_MS + 200));
    expect(calls()).toBe(1);
  });
});
