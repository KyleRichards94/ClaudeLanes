import { STAGES, defaultStageGates, type StageGates } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { eventually, memoryTickets, recordingEmit } from '../testing/sessions';
import { DEFAULT_CHANGES_NOTE, createStageService, firstName } from './stage-service';

const ALL_AUTO = Object.fromEntries(STAGES.map((stage) => [stage, 'auto'])) as StageGates;

/** Stage moves without gates by default (AL-103); the gate tests pass the defaults (AL-104). */
async function setup(stage: 'queued' | 'planning' | 'implementing' | 'code-review' | 'qa' = 'planning', gates: StageGates = ALL_AUTO) {
  const tickets = await memoryTickets({ id: '71273', stage, gates });
  const events = recordingEmit();
  const appendSystem = vi.fn();
  const stages = createStageService({ tickets, emit: events.emit, transcripts: { appendSystem }, userName: () => 'Kyle', now: () => 9_000 });
  return { tickets, events, appendSystem, stages };
}

/** Lets pending promise callbacks run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('stage service (AL-103)', () => {
  it('moves the ticket, saves the stage on its record, emits agent:stage and adds a line to the output', async () => {
    const { tickets, events, appendSystem, stages } = await setup('planning');

    const moved = await stages.setStage('71273', 'implementing', 'Plan ready: 3 sub-agents,\n bUnit tests for the filters');

    expect(moved).toEqual({ ok: true, data: { from: 'planning', to: 'implementing', changed: true } });
    const record = await tickets.get('71273');
    expect(record?.stage).toBe('implementing');
    expect(record?.stageHistory.map((entry) => entry.stage)).toEqual(['planning', 'implementing']);
    expect(events.of('agent:stage')).toEqual([
      { ticketId: '71273', change: 'stage', stage: 'implementing', from: 'planning', activity: 'Plan ready: 3 sub-agents, bUnit tests for the filters', progress: 0 },
    ]);
    expect(appendSystem).toHaveBeenCalledExactlyOnceWith('71273', 'Moved to Implementing · Plan ready: 3 sub-agents, bUnit tests for the filters');
  });

  it('rejects an invalid move with a reason the agent can read, and changes nothing', async () => {
    const { tickets, events, stages } = await setup('planning');
    const moved = await stages.setStage('71273', 'qa', 'skipping ahead');
    expect(moved).toMatchObject({ ok: false, code: 'VALIDATION', message: expect.stringContaining('Cannot move from Planning to QA') });
    expect((await tickets.get('71273'))?.stage).toBe('planning');
    expect(events.events).toEqual([]);
  });

  it('lets QA send the work back to Implementing', async () => {
    const { tickets, stages } = await setup('qa');
    await expect(stages.setStage('71273', 'implementing', '1 acceptance criterion not met')).resolves.toMatchObject({ ok: true });
    expect((await tickets.get('71273'))?.stage).toBe('implementing');
  });

  it('does nothing for the stage the ticket is already in', async () => {
    const { events, stages } = await setup('planning');
    await expect(stages.setStage('71273', 'planning', 'still planning')).resolves.toEqual({ ok: true, data: { from: 'planning', to: 'planning', changed: false } });
    expect(events.events).toEqual([]);
  });

  it('checks moves one at a time, so two calls at once cannot both pass', async () => {
    const { tickets, stages } = await setup('planning');
    const [first, second] = await Promise.all([stages.setStage('71273', 'implementing', 'a'), stages.setStage('71273', 'implementing', 'b')]);
    expect(first).toMatchObject({ ok: true, data: { changed: true } });
    expect(second).toMatchObject({ ok: true, data: { changed: false } });
    expect((await tickets.get('71273'))?.stageHistory).toHaveLength(2);
  });

  it('reports activity and progress without saving anything', async () => {
    const { tickets, events, stages } = await setup('implementing');
    const before = await tickets.get('71273');
    await expect(stages.reportActivity('71273', 'Editing JobControl.razor', 0.46)).resolves.toEqual({ ok: true, data: undefined });
    await stages.reportActivity('71273', 'Over the top', 7);
    await expect(stages.reportActivity('71273', '   ', null)).resolves.toMatchObject({ ok: false });
    expect(events.of('agent:stage')).toEqual([
      { ticketId: '71273', change: 'activity', stage: 'implementing', from: null, activity: 'Editing JobControl.razor', progress: 0.46 },
      { ticketId: '71273', change: 'activity', stage: 'implementing', from: null, activity: 'Over the top', progress: 1 },
    ]);
    expect((await tickets.get('71273'))?.updatedAt).toBe(before?.updatedAt);
  });

  it('moves a Queued ticket to Planning when its session starts, and leaves others alone', async () => {
    const queued = await setup('queued');
    await queued.stages.sessionStarting('71273');
    expect((await queued.tickets.get('71273'))?.stage).toBe('planning');
    expect(queued.events.of('agent:stage')).toEqual([{ ticketId: '71273', change: 'stage', stage: 'planning', from: 'queued', activity: null, progress: 0 }]);

    const implementing = await setup('implementing');
    await implementing.stages.sessionStarting('71273');
    expect((await implementing.tickets.get('71273'))?.stage).toBe('implementing');
    expect(implementing.events.events).toEqual([]);
  });

  it('moves a ticket launched from the team board into the lane it was dropped on (AL-236)', async () => {
    const tickets = await memoryTickets({ id: '71273', stage: 'queued', gates: ALL_AUTO });
    const events = recordingEmit();
    const stages = createStageService({ tickets, emit: events.emit, startLane: (id) => (id === '71273' ? 'implementing' : undefined) });
    await stages.sessionStarting('71273');
    expect((await tickets.get('71273'))?.stage).toBe('implementing');
    expect(events.of('agent:stage')).toEqual([{ ticketId: '71273', change: 'stage', stage: 'implementing', from: 'queued', activity: null, progress: 0 }]);
  });

  it('refuses an unknown ticket', async () => {
    const { stages } = await setup();
    await expect(stages.setStage('99999', 'implementing', 'x')).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
    await expect(stages.reportActivity('99999', 'x', null)).resolves.toMatchObject({ ok: false });
  });
});

describe('stage gates (AL-104)', () => {
  it('holds a gated move until the user approves: the card waits, then moves with "Plan approved by Kyle"', async () => {
    const { tickets, events, appendSystem, stages } = await setup('planning', defaultStageGates());
    let settled = false;
    const moving = stages.setStage('71273', 'implementing', 'Plan ready: cut over frmJobFilter').then((result) => {
      settled = true;
      return result;
    });
    await settle();

    expect(settled).toBe(false);
    expect((await tickets.get('71273'))?.stage).toBe('planning');
    expect(stages.pendingGate('71273')).toEqual({ stage: 'planning', from: 'planning', to: 'implementing', summary: 'Plan ready: cut over frmJobFilter', openedAt: 9_000 });
    expect(events.of('agent:gate')).toEqual([
      { ticketId: '71273', state: 'waiting', stage: 'planning', from: 'planning', to: 'implementing', summary: 'Plan ready: cut over frmJobFilter', note: null },
    ]);
    expect(events.of('agent:stage')).toEqual([]);

    expect(stages.resolveGate('71273', { approve: true })).toBe(true);
    await expect(moving).resolves.toEqual({
      ok: true,
      data: { from: 'planning', to: 'implementing', changed: true, gate: { stage: 'planning', outcome: 'approved', note: null, by: 'Kyle' } },
    });
    expect((await tickets.get('71273'))?.stage).toBe('implementing');
    expect(events.of('agent:gate').at(-1)).toMatchObject({ state: 'approved', stage: 'planning' });
    expect(events.of('agent:stage')).toEqual([expect.objectContaining({ change: 'stage', stage: 'implementing', from: 'planning' })]);
    expect(appendSystem).toHaveBeenLastCalledWith('71273', 'Plan approved by Kyle · moved to Implementing');
    expect(stages.pendingGate('71273')).toBeNull();
  });

  it('Request changes returns the note and leaves the ticket where it was', async () => {
    const { tickets, events, appendSystem, stages } = await setup('planning', defaultStageGates());
    const moving = stages.setStage('71273', 'implementing', 'Plan ready');
    await eventually(() => stages.pendingGate('71273') !== null);

    stages.resolveGate('71273', { approve: false, note: 'Keep frmJobNotes in WinForms.' });
    await expect(moving).resolves.toEqual({
      ok: true,
      data: { from: 'planning', to: 'planning', changed: false, gate: { stage: 'planning', outcome: 'changes-requested', note: 'Keep frmJobNotes in WinForms.', by: 'Kyle' } },
    });
    expect((await tickets.get('71273'))?.stage).toBe('planning');
    expect(events.of('agent:gate').at(-1)).toMatchObject({ state: 'changes-requested', note: 'Keep frmJobNotes in WinForms.' });
    expect(appendSystem).toHaveBeenLastCalledWith('71273', 'Changes requested by Kyle · Keep frmJobNotes in WinForms.');

    // An empty note still tells the agent something.
    const again = stages.setStage('71273', 'implementing', 'Plan v2');
    await eventually(() => stages.pendingGate('71273') !== null);
    stages.resolveGate('71273', { approve: false, note: '   ' });
    await expect(again).resolves.toMatchObject({ data: { gate: { note: DEFAULT_CHANGES_NOTE } } });
  });

  it('waits on the Create PR gate before the move into Create PR', async () => {
    const { stages } = await setup('qa', defaultStageGates());
    const moving = stages.setStage('71273', 'create-pr', 'QA passed: 5 of 5 criteria');
    await eventually(() => stages.pendingGate('71273') !== null);
    expect(stages.pendingGate('71273')).toMatchObject({ stage: 'create-pr', from: 'qa', to: 'create-pr' });
    stages.resolveGate('71273', { approve: true });
    await expect(moving).resolves.toMatchObject({ data: { changed: true, to: 'create-pr' } });
  });

  it('lets Auto stages and moves back to Implementing through without waiting', async () => {
    const implementing = await setup('implementing', defaultStageGates());
    await expect(implementing.stages.setStage('71273', 'code-review', 'Done')).resolves.toMatchObject({ data: { changed: true } });
    expect(implementing.events.of('agent:gate')).toEqual([]);

    const qa = await setup('qa', { ...defaultStageGates(), qa: 'approval' });
    await expect(qa.stages.setStage('71273', 'implementing', '1 gap')).resolves.toMatchObject({ data: { changed: true } });
    expect(qa.events.of('agent:gate')).toEqual([]);
  });

  it('turning the waiting gate off releases it as approved; another gate leaves it waiting', async () => {
    const { tickets, appendSystem, stages } = await setup('planning', defaultStageGates());
    const moving = stages.setStage('71273', 'implementing', 'Plan ready');
    await eventually(() => stages.pendingGate('71273') !== null);

    await expect(stages.setGate('71273', 'create-pr', 'auto')).resolves.toMatchObject({ ok: true, data: { released: false } });
    expect(stages.pendingGate('71273')).not.toBeNull();

    await expect(stages.setGate('71273', 'planning', 'auto')).resolves.toMatchObject({ ok: true, data: { released: true, gates: { planning: 'auto', 'create-pr': 'auto' } } });
    await expect(moving).resolves.toMatchObject({ data: { changed: true, gate: { outcome: 'approved', by: null } } });
    expect((await tickets.get('71273'))?.stage).toBe('implementing');
    expect(appendSystem).toHaveBeenLastCalledWith('71273', 'Plan approved (gate switched off) · moved to Implementing');
  });

  it('saves gate changes on the ticket record', async () => {
    const { tickets, stages } = await setup('implementing', defaultStageGates());
    await stages.setGate('71273', 'qa', 'approval');
    expect((await tickets.get('71273'))?.gates).toEqual({ ...defaultStageGates(), qa: 'approval' });
    await expect(stages.setGate('99999', 'qa', 'auto')).resolves.toMatchObject({ ok: false });
  });

  it('closes the gate when the turn is interrupted or the session ends', async () => {
    const { events, stages } = await setup('planning', defaultStageGates());
    const abort = new AbortController();
    const interrupted = stages.setStage('71273', 'implementing', 'Plan ready', { signal: abort.signal });
    await eventually(() => stages.pendingGate('71273') !== null);
    abort.abort();
    await expect(interrupted).resolves.toMatchObject({ data: { changed: false, gate: { outcome: 'cancelled' } } });
    expect(events.of('agent:gate').at(-1)).toMatchObject({ state: 'cancelled' });

    const ended = stages.setStage('71273', 'implementing', 'Plan ready');
    await eventually(() => stages.pendingGate('71273') !== null);
    stages.cancelGate('71273');
    await expect(ended).resolves.toMatchObject({ data: { changed: false, gate: { outcome: 'cancelled' } } });
    expect(stages.resolveGate('71273', { approve: true })).toBe(false);
  });

  it('names the approver by first name', () => {
    expect(firstName('Kyle.Richards')).toBe('Kyle');
    expect(firstName('kyle')).toBe('Kyle');
  });
});
