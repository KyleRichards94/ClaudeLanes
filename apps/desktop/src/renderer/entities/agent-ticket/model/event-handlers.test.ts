import { describe, expect, it, vi } from 'vitest';
import { fakeGateEvent, fakeOutputEvent, fakeStageEvent, fakeSubagentEvent, fakeTicketRecord } from '@/shared/testing';
import { agentTicketEventHandlers, createAgentTicketEventHandlers } from './event-handlers';
import { selectLaneNeedsYouCount, selectTicket, ticketNeedsYou } from './selectors';
import { createAgentTicketStore } from './store';

function setup() {
  const store = createAgentTicketStore();
  store.load([fakeTicketRecord({ id: '71273' }), fakeTicketRecord({ id: '71288' })]);
  const commits = vi.fn();
  store.subscribe(commits);
  return { store, commits, handlers: createAgentTicketEventHandlers(store) };
}

describe('agent ticket event handlers', () => {
  it('handles the batched agent:output channel, agent:stage, agent:gate, agent:model, agent:subagent, agent:permission, build:queued, build:finished and run:status', () => {
    expect(Object.keys(agentTicketEventHandlers).sort()).toEqual([
      'agent:gate',
      'agent:model',
      'agent:output',
      'agent:permission',
      'agent:stage',
      'agent:subagent',
      'build:finished',
      'build:queued',
      'run:status',
    ]);
  });

  it("agent:subagent sets that ticket's sub-agent counts from the SDK's task states (AL-107)", () => {
    const { store, handlers } = setup();

    handlers['agent:subagent']?.(fakeSubagentEvent('71273', 2_000, { counts: { queued: 1, running: 2, done: 1, failed: 0 } }));

    expect(selectTicket(store.getState(), '71273')?.subAgents).toEqual({ queued: 1, running: 2, done: 1, failed: 0 });
    expect(selectTicket(store.getState(), '71288')?.subAgents).toEqual({ queued: 0, running: 0, done: 0, failed: 0 });
  });

  it('a waiting gate makes the card need the user (amber) until it is decided (AL-104)', () => {
    const { store, handlers } = setup();
    store.setStage('71273', 'planning', 1_500);

    handlers['agent:gate']?.(fakeGateEvent('71273', 3_000));
    const waiting = selectTicket(store.getState(), '71273');
    expect(waiting?.gate).toEqual({ stage: 'planning', openedAt: 3_000 });
    expect(waiting && ticketNeedsYou(waiting)).toBe(true);
    expect(waiting?.needsYou).toEqual([{ kind: 'approval', stage: 'planning', since: 3_000 }]);
    expect(selectLaneNeedsYouCount(store.getState(), 'planning')).toBe(1);

    handlers['agent:gate']?.(fakeGateEvent('71273', 3_500, { state: 'changes-requested', note: 'Keep frmJobNotes' }));
    const decided = selectTicket(store.getState(), '71273');
    expect(decided?.gate).toBeNull();
    expect(decided && ticketNeedsYou(decided)).toBe(false);

    handlers['agent:gate']?.(fakeGateEvent('71273', 4_000));
    handlers['agent:gate']?.(fakeGateEvent('71273', 4_100, { state: 'cancelled' }));
    expect(selectTicket(store.getState(), '71273')?.gate).toBeNull();
  });

  it('agent:stage moves the card to its new lane and shows the stage summary as its activity (AL-103)', () => {
    const { store, handlers } = setup();
    store.setStage('71273', 'planning', 1_500);
    store.setActivity('71273', { text: 'Mapping child modals', progress: 0.8 }, 1_600);

    handlers['agent:stage']?.(fakeStageEvent('71273', 3_000, { stage: 'implementing', from: 'planning', activity: 'Plan approved', progress: 0 }));

    const ticket = selectTicket(store.getState(), '71273');
    expect(ticket).toMatchObject({ stage: 'implementing', stageEnteredAt: 3_000, activity: { text: 'Plan approved', at: 3_000 }, progress: 0 });
    expect(store.getState().byLane.implementing).toContain('71273');
    expect(store.getState().byLane.planning).not.toContain('71273');
  });

  it('agent:stage activity updates change only the activity row and progress', () => {
    const { store, handlers } = setup();
    handlers['agent:stage']?.(fakeStageEvent('71273', 3_000, { change: 'activity', stage: 'implementing', from: null, activity: 'Editing JobControl.razor', progress: 0.46 }));
    handlers['agent:stage']?.(fakeStageEvent('71273', 3_100, { change: 'activity', stage: 'implementing', from: null, activity: 'Running the build', progress: null }));
    expect(selectTicket(store.getState(), '71273')).toMatchObject({ stage: 'implementing', stageEnteredAt: 2_000, activity: { text: 'Running the build' }, progress: 0.46 });
  });

  it('a stage change without a summary clears the previous activity', () => {
    const { store, handlers } = setup();
    store.setActivity('71273', { text: 'old', progress: 0.5 }, 2_500);
    handlers['agent:stage']?.(fakeStageEvent('71273', 3_000, { stage: 'code-review', from: 'implementing', activity: null, progress: 0 }));
    expect(selectTicket(store.getState(), '71273')).toMatchObject({ stage: 'code-review', activity: null, progress: 0 });
  });

  it('follows a run through run:status and keeps the last build from build:finished (AL-173)', () => {
    const { store, handlers } = setup();
    const run = { ticketId: '71273', runId: 'run-1', runKind: 'web', port: 5080, startedAt: 10, stoppedAt: null, exitCode: null, message: null, at: 10 } as const;

    handlers['run:status']?.({ ...run, state: 'starting', url: null });
    expect(selectTicket(store.getState(), '71273')?.run).toEqual({ state: 'starting', url: null, startedAt: 10 });
    handlers['run:status']?.({ ...run, state: 'running', url: 'http://localhost:5080/', at: 11 });
    expect(selectTicket(store.getState(), '71273')?.run).toEqual({ state: 'running', url: 'http://localhost:5080/', startedAt: 10 });

    const error = { severity: 'error', code: 'CS0246', message: 'JobFilterState not found', file: 'a.cs', line: 1, column: 1 } as const;
    handlers['build:finished']?.({
      jobId: 'job-1',
      ticketId: '71273',
      kind: 'build',
      outcome: 'failed',
      command: 'dotnet build',
      exitCode: 1,
      errors: 3,
      warnings: 0,
      diagnostics: [{ ...error, severity: 'warning', code: 'CS0168' }, error],
      startedAt: 20,
      finishedAt: 30,
      at: 30,
    });
    expect(selectTicket(store.getState(), '71273')?.build.last).toEqual({
      outcome: 'failed',
      startedAt: 20,
      finishedAt: 30,
      errors: 3,
      warnings: 0,
      firstError: error,
    });
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
