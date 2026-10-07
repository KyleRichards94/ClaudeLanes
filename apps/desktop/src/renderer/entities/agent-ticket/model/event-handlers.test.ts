import { describe, expect, it, vi } from 'vitest';
import { fakeOutputEvent, fakeTicketRecord } from '@/shared/testing';
import { agentTicketEventHandlers, createAgentTicketEventHandlers } from './event-handlers';
import { selectTicket } from './selectors';
import { createAgentTicketStore } from './store';

function setup() {
  const store = createAgentTicketStore();
  store.load([fakeTicketRecord({ id: '71273' }), fakeTicketRecord({ id: '71288' })]);
  const commits = vi.fn();
  store.subscribe(commits);
  return { store, commits, handlers: createAgentTicketEventHandlers(store) };
}

describe('agent ticket event handlers', () => {
  it('handles the batched agent:output channel and build:queued', () => {
    expect(Object.keys(agentTicketEventHandlers).sort()).toEqual(['agent:output', 'build:queued']);
  });

  it('commits a frame of agent:output as one store update', () => {
    const { store, commits, handlers } = setup();

    handlers['agent:output']?.(Array.from({ length: 1000 }, (_, at) => fakeOutputEvent('71273', at)));

    expect(commits).toHaveBeenCalledOnce();
    expect(selectTicket(store.getState(), '71273')?.lastOutputAt).toBe(999);
    expect(selectTicket(store.getState(), '71288')?.lastOutputAt).toBeNull();
  });

  it("shows a ticket's build job from build:queued until it finishes", () => {
    const { store, handlers } = setup();
    const job = { ticketId: '71273', jobId: 'job-1', kind: 'build', queuedAt: 1, startedAt: null, finishedAt: null, at: 1 } as const;

    handlers['build:queued']?.({ ...job, state: 'queued', position: 1 });
    expect(selectTicket(store.getState(), '71273')?.build.job).toEqual({ jobId: 'job-1', kind: 'build', state: 'queued', position: 1 });

    handlers['build:queued']?.({ ...job, state: 'running', position: null, startedAt: 2, at: 2 });
    expect(selectTicket(store.getState(), '71273')?.build.job?.state).toBe('running');

    handlers['build:queued']?.({ ...job, state: 'finished', position: null, startedAt: 2, finishedAt: 3, at: 3 });
    expect(selectTicket(store.getState(), '71273')?.build.job).toBeNull();
  });

  it('ignores events for tickets the board has not loaded', () => {
    const { commits, handlers } = setup();
    handlers['agent:output']?.([fakeOutputEvent('99999', 1)]);
    handlers['build:queued']?.({
      ticketId: '99999',
      jobId: 'job-9',
      kind: 'run',
      state: 'queued',
      position: 1,
      queuedAt: 1,
      startedAt: null,
      finishedAt: null,
      at: 1,
    });
    expect(commits).not.toHaveBeenCalled();
  });
});
