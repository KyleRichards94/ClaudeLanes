import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { installFakeBridge } from '@/shared/testing';
import { useRefreshSkills, useSkills } from './skills';

const REPO = 'C:\\src\\onsite-companion';

describe('skills queries (AL-114)', () => {
  it('reads a repo once, waits for a repo, and refreshes on demand', async () => {
    const data = { repo: REPO, skills: [{ name: 'code-review', description: 'Review', argumentHint: '' }], loadedAt: 1 };
    const bridge = installFakeBridge({ 'skills:list': { ok: true, data } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

    renderHook(() => useSkills(null), { wrapper });
    expect(bridge.invoke).not.toHaveBeenCalled();

    const { result } = renderHook(() => ({ skills: useSkills(REPO), refresh: useRefreshSkills(REPO) }), { wrapper });
    await waitFor(() => expect(result.current.skills.data?.skills).toHaveLength(1));
    expect(bridge.invoke).toHaveBeenCalledWith('skills:list', { repo: REPO });

    await act(() => result.current.refresh.mutateAsync());
    expect(bridge.invoke).toHaveBeenLastCalledWith('skills:list', { repo: REPO, refresh: true });
  });
});
