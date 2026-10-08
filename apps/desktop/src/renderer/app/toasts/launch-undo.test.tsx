import { LAUNCH_UNDO_WINDOW_MS, type LaunchFromAdoResponse } from '@agent-lanes/contracts';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentTicketStore } from '@/entities/agent-ticket';
import { showLaunchToast } from '@/features/launch-from-ado';
import { clearToasts } from '@/shared/model';
import { RouterProvider, createRouter } from '@/shared/routing';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { ToastHost } from './ToastHost';

/**
 * AL-237 through the app's ToastHost: the launch toast is a polite live region, and its Undo is a real
 * button the keyboard reaches for the whole 10 s (TB§7).
 */

const launched: LaunchFromAdoResponse = {
  ticketId: '71318',
  record: fakeTicketRecord({ id: '71318', stage: 'planning' }),
  status: { ticketId: '71318', state: 'running', sessionId: null, message: null },
  adoChange: { workItemId: 71318, previousAssignee: null, previousState: 'Failed UAT', state: 'Active' },
  undoId: 'u'.repeat(48),
  summary: '#71318 assigned to you and moved to In Progress · agent started in Planning',
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
});

afterEach(() => {
  act(() => clearToasts());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('launch toast in the ToastHost (AL-237)', () => {
  it('reaches Undo by keyboard just before 10 s, and Enter undoes the launch', async () => {
    const bridge = installFakeBridge({
      'agent:undoLaunch': { ok: true, data: { ticketId: '71318', worktreeRemoved: true, leftovers: [], adoRestored: true, summary: '#71318 is back in Failed UAT, unassigned · the worktree and agent are gone' } },
    });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <RouterProvider router={createRouter()}>
        <ToastHost />
      </RouterProvider>,
    );
    act(() => {
      showLaunchToast(launched, { store: createAgentTicketStore(), refresh: () => undefined });
    });

    const region = screen.getByRole('region', { name: 'Notifications' });
    const notice = within(region).getByRole('status');
    expect(notice.textContent).toContain('Agent started in Planning');
    expect(notice.textContent).toContain(launched.summary);

    act(() => {
      vi.advanceTimersByTime(LAUNCH_UNDO_WINDOW_MS - 200);
    });
    for (let i = 0; i < 10 && document.activeElement?.textContent !== 'Undo'; i += 1) await user.tab();
    expect(document.activeElement?.textContent).toBe('Undo');
    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('agent:undoLaunch', { undoId: launched.undoId }));
  });

  it('has no Undo button once the 10 s are up', () => {
    installFakeBridge();
    render(
      <RouterProvider router={createRouter()}>
        <ToastHost />
      </RouterProvider>,
    );
    act(() => {
      showLaunchToast(launched, { store: createAgentTicketStore(), refresh: () => undefined });
    });
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(LAUNCH_UNDO_WINDOW_MS);
    });
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });
});
