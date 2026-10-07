import { describe, expect, it, vi } from 'vitest';
import { memoryTickets, recordingEmit } from '../testing/sessions';
import { createStageService } from './stage-service';

async function setup(stage: 'queued' | 'planning' | 'implementing' | 'qa' = 'planning') {
  const tickets = await memoryTickets({ id: '71273', stage });
  const events = recordingEmit();
  const appendSystem = vi.fn();
  const stages = createStageService({ tickets, emit: events.emit, transcripts: { appendSystem } });
  return { tickets, events, appendSystem, stages };
}

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

  it('refuses an unknown ticket', async () => {
    const { stages } = await setup();
    await expect(stages.setStage('99999', 'implementing', 'x')).resolves.toMatchObject({ ok: false, code: 'VALIDATION' });
    await expect(stages.reportActivity('99999', 'x', null)).resolves.toMatchObject({ ok: false });
  });
});
