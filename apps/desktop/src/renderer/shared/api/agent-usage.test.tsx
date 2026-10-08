import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { emptyAgentUsage, type AgentUsage } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { installFakeBridge } from '@/shared/testing';
import { agentUsageEventHandlers, useAgentUsage } from './agent-usage';

const usage: AgentUsage = { ...emptyAgentUsage('71273'), totalTokens: 412_000, leadTokens: 212_000, costUsd: 3.1, turns: 4, updatedAt: 5 };

describe('agent usage queries (AL-113)', () => {
  it('reads the usage once, then follows agent:usage events', async () => {
    const bridge = installFakeBridge({ 'agent:getUsage': { ok: true, data: usage } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useAgentUsage('71273'), { wrapper });

    await waitFor(() => expect(result.current.data?.totalTokens).toBe(412_000));
    expect(bridge.invoke).toHaveBeenCalledWith('agent:getUsage', { ticketId: '71273' });

    const handlers = agentUsageEventHandlers(client);
    act(() => handlers['agent:usage']?.({ ticketId: '71273', at: 6, usage: { ...usage, totalTokens: 450_000 } }));
    await waitFor(() => expect(result.current.data?.totalTokens).toBe(450_000));
    expect(bridge.invoke).toHaveBeenCalledTimes(1);
  });
});
