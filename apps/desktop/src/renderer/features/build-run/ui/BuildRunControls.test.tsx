import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAgentTicketEventHandlers, createAgentTicketStore, useAgentTicket, type AgentTicketStore } from '@/entities/agent-ticket';
import { clearToasts, getToasts } from '@/shared/model';
import { fakeTicketRecord, installFakeBridge } from '@/shared/testing';
import { BuildRunControls } from './BuildRunControls';

function Harness({ store }: { store: AgentTicketStore }) {
  const ticket = useAgentTicket('71273', store);
  return ticket ? <BuildRunControls ticket={ticket} /> : null;
}

function setup(replies: Parameters<typeof installFakeBridge>[0] = {}) {
  const bridge = installFakeBridge(replies);
  const store = createAgentTicketStore();
  store.load([fakeTicketRecord({ id: '71273', lastBuild: null, lastRun: null })]);
  const handlers = createAgentTicketEventHandlers(store);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness store={store} />
    </QueryClientProvider>,
  );
  return { bridge, handlers };
}

const button = (name: string) => screen.getByRole('button', { name });

afterEach(() => clearToasts());

describe('BuildRunControls (AL-173)', () => {
  it('starts a build and follows the queued, running and finished events', async () => {
    const { bridge, handlers } = setup({ 'build:start': { ok: false, code: 'BUILD_FAILED', message: 'Build failed' } });
    expect(screen.getByText('Not built yet')).toBeTruthy();
    expect(button('Stop').getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(button('Build'));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('build:start', { ticketId: '71273' }));

    const job = { ticketId: '71273', jobId: 'job-1', kind: 'build', queuedAt: 1, startedAt: null, finishedAt: null, at: 1 } as const;
    act(() => handlers['build:queued']?.({ ...job, state: 'queued', position: 2 }));
    expect(screen.getByText('Build queued · #2')).toBeTruthy();
    expect(button('Build').getAttribute('aria-busy')).toBe('true');
    expect(button('Run').getAttribute('aria-disabled')).toBe('true');
    expect(button('Stop').getAttribute('aria-disabled')).toBeNull();

    act(() => handlers['build:queued']?.({ ...job, state: 'running', position: null, startedAt: 2, at: 2 }));
    expect(screen.getByText('Building…')).toBeTruthy();

    act(() => {
      handlers['build:queued']?.({ ...job, state: 'finished', position: null, startedAt: 2, finishedAt: 3, at: 3 });
      handlers['build:finished']?.({
        jobId: 'job-1',
        ticketId: '71273',
        kind: 'build',
        outcome: 'failed',
        command: 'dotnet build',
        exitCode: 1,
        errors: 3,
        warnings: 0,
        diagnostics: [],
        startedAt: 2,
        finishedAt: new Date(2026, 9, 7, 14, 2).getTime(),
        at: 3,
      });
    });
    expect(screen.getByTestId('build-run-build-status').textContent).toBe('Last build 14:02 · failed · 3 errors');
    // A failed build is shown in the panel, not as a toast.
    await waitFor(() => expect(button('Build').getAttribute('aria-busy')).toBeNull());
    expect(getToasts()).toEqual([]);
  });

  it('runs, shows the URL from run:status, opens it and stops', async () => {
    const { bridge, handlers } = setup({
      'run:start': { ok: true, data: { ticketId: '71273', runId: 'r1', state: 'starting', runKind: 'web', port: 5080, url: null, startedAt: 10, stoppedAt: null, exitCode: null, message: null } },
      'run:stop': { ok: true, data: { stopped: true } },
      'run:openUrl': { ok: true, data: { opened: true } },
    });
    fireEvent.click(button('Run'));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('run:start', { ticketId: '71273' }));

    const status = { ticketId: '71273', runId: 'r1', runKind: 'web', port: 5080, startedAt: 10, stoppedAt: null, exitCode: null, message: null } as const;
    act(() => handlers['run:status']?.({ ...status, state: 'starting', url: null, at: 10 }));
    expect(screen.getByText('Starting…')).toBeTruthy();
    expect(button('Build').getAttribute('aria-disabled')).toBe('true');

    act(() => handlers['run:status']?.({ ...status, state: 'running', url: 'http://localhost:5080/', at: 11 }));
    fireEvent.click(screen.getByRole('link', { name: 'Open http://localhost:5080/' }));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('run:openUrl', { ticketId: '71273' }));

    fireEvent.click(button('Stop'));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('run:stop', { ticketId: '71273' }));
    act(() => handlers['run:status']?.({ ...status, state: 'stopped', url: null, stoppedAt: 20, at: 20 }));
    expect(screen.getByText('Not running')).toBeTruthy();
    await waitFor(() => expect(button('Stop').getAttribute('aria-disabled')).toBe('true'));
    expect(button('Run').getAttribute('aria-disabled')).toBeNull();
  });

  it('cancels a queued build from Stop and reports a refused call', async () => {
    const { bridge, handlers } = setup({
      'build:cancel': { ok: true, data: { cancelled: true } },
      'run:start': { ok: false, code: 'VALIDATION', message: 'The repo has no run command.' },
    });
    act(() => handlers['build:queued']?.({ ticketId: '71273', jobId: 'job-7', kind: 'build', state: 'queued', position: 1, queuedAt: 1, startedAt: null, finishedAt: null, at: 1 }));
    fireEvent.click(button('Stop'));
    await waitFor(() => expect(bridge.invoke).toHaveBeenCalledWith('build:cancel', { jobId: 'job-7' }));

    act(() => handlers['build:queued']?.({ ticketId: '71273', jobId: 'job-7', kind: 'build', state: 'cancelled', position: null, queuedAt: 1, startedAt: null, finishedAt: 2, at: 2 }));
    fireEvent.click(button('Run'));
    await waitFor(() => expect(getToasts()).toHaveLength(1));
    expect(getToasts()[0]).toMatchObject({ tone: 'error', title: "Couldn't run the app", body: 'The repo has no run command.' });
    vi.restoreAllMocks();
  });
});
