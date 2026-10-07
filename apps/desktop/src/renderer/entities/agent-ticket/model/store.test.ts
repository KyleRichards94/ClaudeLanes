import { LANES, type TicketRecord } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { fakeTicketRecord } from '@/shared/testing';
import {
  selectLaneNeedsYouCount,
  selectLaneNeedsYouTicketIds,
  selectLaneTicketIds,
  selectTicket,
  selectTicketCount,
  selectTicketTotal,
  selectWorkItemLanes,
} from './selectors';
import { createAgentTicketStore, type AgentTicketStore } from './store';

/** The artboard 1 board: one card in Queued, Planning, Code review, QA and Create PR; two in Implementing. */
function boardRecords(): TicketRecord[] {
  return [
    fakeTicketRecord({ id: '71330', stage: 'queued', stageEnteredAt: 100 }),
    fakeTicketRecord({ id: '71322', stage: 'planning', stageEnteredAt: 110 }),
    fakeTicketRecord({ id: '71288', stage: 'implementing', stageEnteredAt: 130 }),
    fakeTicketRecord({ id: '71273', stage: 'implementing', stageEnteredAt: 120 }),
    fakeTicketRecord({ id: '71301', stage: 'code-review', stageEnteredAt: 140 }),
    fakeTicketRecord({ id: '71310', stage: 'qa', stageEnteredAt: 150 }),
    fakeTicketRecord({ id: '71266', stage: 'create-pr', stageEnteredAt: 160 }),
  ];
}

function loadedStore(): AgentTicketStore {
  const store = createAgentTicketStore();
  store.load(boardRecords());
  return store;
}

const ids = (store: AgentTicketStore, lane: (typeof LANES)[number]) => selectLaneTicketIds(store.getState(), lane);

describe('agent ticket store', () => {
  it('loads records into lanes, each lane oldest entry first', () => {
    const store = loadedStore();
    expect(Object.fromEntries(LANES.map((lane) => [lane, ids(store, lane)]))).toEqual({
      queued: ['71330'],
      planning: ['71322'],
      implementing: ['71273', '71288'],
      'code-review': ['71301'],
      qa: ['71310'],
      'create-pr': ['71266'],
      done: [],
    });
    expect(selectTicket(store.getState(), '71273')?.title).toBe('Cutover frmJobControl to Blazor');
    expect(selectTicket(store.getState(), 'constructor')).toBeUndefined();
  });

  it('replaces only the changed ticket and keeps every lane array while a ticket streams', () => {
    const store = loadedStore();
    const before = store.getState();

    store.setActivity('71273', { text: 'Editing JobControl.razor +214', progress: 0.45 }, 200);
    store.recordOutput([{ ticketId: '71273', at: 201 }]);

    const after = store.getState();
    expect(after.byLane).toBe(before.byLane);
    expect(after.byId.get('71273')).not.toBe(before.byId.get('71273'));
    for (const id of ['71330', '71322', '71288', '71301', '71310', '71266']) expect(after.byId.get(id)).toBe(before.byId.get(id));
  });

  it('moves a ticket between lanes, replacing only the two lanes it left and entered', () => {
    const store = loadedStore();
    const before = store.getState().byLane;

    store.setStage('71273', 'code-review', 300);

    const after = store.getState().byLane;
    expect(after.implementing).toEqual(['71288']);
    expect(after['code-review']).toEqual(['71301', '71273']);
    for (const lane of LANES.filter((lane) => lane !== 'implementing' && lane !== 'code-review')) expect(after[lane]).toBe(before[lane]);
  });

  it('commits once per action, and not at all for no change or an unknown ticket', () => {
    const store = loadedStore();
    const commits = vi.fn();
    store.subscribe(commits);

    store.setStage('71273', 'implementing', 400);
    store.setActivity('nope', { text: 'x' }, 400);
    store.recordOutput([]);
    store.recordOutput([{ ticketId: 'nope', at: 400 }]);
    store.resolveGate('71273');
    store.remove('nope');
    store.upsert(boardRecords()[3]!);
    expect(commits).not.toHaveBeenCalled();

    store.openGate('71322', 'planning', 410);
    expect(commits).toHaveBeenCalledTimes(1);
  });

  it('commits a frame of output across tickets once, stamping each ticket with its newest output', () => {
    const store = loadedStore();
    const commits = vi.fn();
    store.subscribe(commits);

    store.recordOutput([
      { ticketId: '71273', at: 500 },
      { ticketId: '71288', at: 502 },
      { ticketId: '71273', at: 503 },
      { ticketId: '71273', at: 501 },
    ]);

    expect(commits).toHaveBeenCalledOnce();
    expect(selectTicket(store.getState(), '71273')?.lastOutputAt).toBe(503);
    expect(selectTicket(store.getState(), '71288')?.lastOutputAt).toBe(502);
  });

  it('keeps live state across a reload of the records and drops tickets that are gone', () => {
    const store = loadedStore();
    store.openGate('71322', 'planning', 600);
    store.setSubAgentCounts('71273', { queued: 0, running: 3, done: 0, failed: 0 });

    store.load(boardRecords().filter((record) => record.id !== '71330'));

    expect(ids(store, 'queued')).toEqual([]);
    expect(selectTicket(store.getState(), '71330')).toBeUndefined();
    expect(selectTicket(store.getState(), '71322')?.gate).toEqual({ stage: 'planning', openedAt: 600 });
    expect(selectTicket(store.getState(), '71273')?.subAgents.running).toBe(3);
  });

  it('upserts a launched ticket into its lane, and re-places a ticket whose lane entry time changed', () => {
    const store = loadedStore();
    store.upsert(fakeTicketRecord({ id: '71400', stage: 'planning', stageEnteredAt: 105 }));
    expect(ids(store, 'planning')).toEqual(['71400', '71322']);

    store.upsert(fakeTicketRecord({ id: '71400', stage: 'planning', stageEnteredAt: 115 }));
    expect(ids(store, 'planning')).toEqual(['71322', '71400']);

    store.remove('71400');
    expect(ids(store, 'planning')).toEqual(['71322']);
  });

  it('orders cards that entered a lane together by creation time, then id', () => {
    const store = createAgentTicketStore();
    store.load([
      fakeTicketRecord({ id: 'b', stage: 'qa', stageEnteredAt: 10, createdAt: 5 }),
      fakeTicketRecord({ id: 'c', stage: 'qa', stageEnteredAt: 10, createdAt: 1 }),
      fakeTicketRecord({ id: 'a', stage: 'qa', stageEnteredAt: 10, createdAt: 5 }),
    ]);
    expect(ids(store, 'qa')).toEqual(['c', 'a', 'b']);
  });

  it('counts the header pills and dock totals, and the amber lane badges', () => {
    const store = loadedStore();
    store.openGate('71301', 'code-review', 700);
    store.setNeedsYou('71310', { kind: 'qa-gap', gaps: 1, since: 700 });
    store.setSubAgentCounts('71273', { queued: 0, running: 3, done: 0, failed: 0 });
    store.setSubAgentCounts('71288', { queued: 1, running: 1, done: 2, failed: 0 });
    store.applyBuildJob({ ticketId: '71288', jobId: 'job-1', kind: 'build', state: 'running', position: null });
    store.applyBuildJob({ ticketId: '71273', jobId: 'job-2', kind: 'build', state: 'queued', position: 1 });
    store.setStage('71266', 'done', 710);

    const state = store.getState();
    expect(selectTicketCount(state, 'running')).toBe(3);
    expect(selectTicketCount(state, 'needs-you')).toBe(2);
    expect(selectTicketCount(state, 'queued')).toBe(1);
    expect(selectTicketCount(state, 'sub-agents-running')).toBe(4);
    expect(selectTicketCount(state, 'builds-running')).toBe(1);
    expect(selectLaneNeedsYouCount(state, 'code-review')).toBe(1);
    expect(selectLaneNeedsYouCount(state, 'qa')).toBe(1);
    expect(selectLaneNeedsYouCount(state, 'implementing')).toBe(0);
    // The header's "need you" filter and the sub-header's total (AL-142).
    expect(selectLaneNeedsYouTicketIds(state, 'code-review')).toEqual(['71301']);
    expect(selectLaneNeedsYouTicketIds(state, 'implementing')).toEqual([]);
    expect(selectTicketTotal(state)).toBe(7);
    // The New agent ticket picker's running work items (AL-161): every ticket but the Done one.
    expect(selectWorkItemLanes(state)).toEqual({ 71330: 'queued', 71322: 'planning', 71288: 'implementing', 71273: 'implementing', 71301: 'code-review', 71310: 'qa' });
  });

  it('routes every action to its ticket', () => {
    const store = loadedStore();
    store.requestModelChange('71273', { model: 'sonnet', effort: 'high' }, 800);
    expect(selectTicket(store.getState(), '71273')?.switching).toEqual({ model: 'sonnet', effort: 'high', requestedAt: 800 });
    store.applyModelChange('71273');
    expect(selectTicket(store.getState(), '71273')).toMatchObject({ model: 'sonnet', effort: 'high', switching: null });

    store.setNeedsYou('71273', { kind: 'permission', tool: 'Bash', since: 810 });
    store.clearNeedsYou('71273', 'permission');
    expect(selectTicket(store.getState(), '71273')?.needsYou).toEqual([]);

    store.setPullRequest('71266', { id: 10612, status: 'active', checks: null });
    store.setLastBuild('71273', { outcome: 'failed', startedAt: 1, finishedAt: 2, errors: 3, warnings: 0 });
    store.setRun('71273', { state: 'running', url: null, startedAt: 820 });
    expect(selectTicket(store.getState(), '71266')?.pullRequest?.id).toBe(10612);
    expect(selectTicket(store.getState(), '71273')?.build.last?.errors).toBe(3);
    expect(selectTicket(store.getState(), '71273')?.run.state).toBe('running');
  });
});
