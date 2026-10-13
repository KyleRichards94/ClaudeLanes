import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { AgentOutputEvent, ReviewFinding } from '@agent-lanes/contracts';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { noteOutputEvents, resetOutputSettle } from '@/shared/model';
import { installFakeBridge } from '@/shared/testing';
import { REVIEW_FINDINGS_REFRESH_MS, cancelReviewFindingsRefreshes, useReviewFindings } from './review-findings';

const findings: ReviewFinding[] = [{ id: 'rev:a.cs:7:0', filePath: 'a.cs', line: 7, severity: 'warn', text: 'Dispose it.', agentId: 'rev' }];

const turnEnd = (ticketId: string): AgentOutputEvent => ({
  ticketId,
  at: 1,
  seq: 1,
  item: {
    kind: 'result',
    subtype: 'success',
    isError: false,
    durationMs: 1,
    numTurns: 1,
    costUsd: 0,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
    parentToolUseId: null,
  },
});

function setup() {
  const bridge = installFakeBridge({ 'review:findings': { ok: true, data: findings } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const calls = () => vi.mocked(bridge.invoke).mock.calls.filter(([channel]) => channel === 'review:findings').length;
  return { client, wrapper, calls };
}

describe('useReviewFindings (AL-277)', () => {
  beforeEach(() => resetOutputSettle());
  afterEach(() => cancelReviewFindingsRefreshes());

  it('reads the findings under ["review","findings",ticketId]', async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useReviewFindings('71273'), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual(findings));
    expect(client.getQueryData(['review', 'findings', '71273'])).toEqual(findings);
  });

  it('reads again after the reviewer’s turn ends, whether it is the lead’s or a watched second agent’s', async () => {
    const { wrapper, calls } = setup();
    const { result } = renderHook(() => useReviewFindings('71273', { watch: ['71273-reviewer'] }), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());

    act(() => noteOutputEvents([turnEnd('71273-reviewer')]));
    await waitFor(() => expect(calls()).toBe(2), { timeout: REVIEW_FINDINGS_REFRESH_MS * 3 });

    // Another ticket's turn is none of its business.
    act(() => noteOutputEvents([turnEnd('other')]));
    await new Promise((resolve) => setTimeout(resolve, REVIEW_FINDINGS_REFRESH_MS + 200));
    expect(calls()).toBe(2);
  });
});
