import { describe, expect, it, vi } from 'vitest';
import { ok, type AgentSessionStatus, type AgentTranscript } from '@agent-lanes/contracts';
import type { SessionStartRequest } from '../session-manager';
import { memoryTickets } from '../testing/sessions';
import { HAND_OVER_ECHO, SESSION_REPLACED_MESSAGE, createAssignAgentService, newAgentLine } from './assign-agent';
import { HAND_OVER_HEADING } from './hand-over-brief';

const status = (state: AgentSessionStatus['state'], sessionId: string | null = 'session-a'): AgentSessionStatus => ({ ticketId: '71273', state, sessionId, message: null });

async function setup(options: { state?: AgentSessionStatus['state']; sessionId?: string | null; job?: string } = {}) {
  const tickets = await memoryTickets({ id: '71273' });
  await tickets.update('71273', (record) => ({ ...record, sessionId: options.sessionId === undefined ? 'session-a' : options.sessionId, ...(options.job ? { job: options.job } : {}) }));
  const transcript: AgentTranscript = {
    ticketId: '71273',
    lastSeq: 2,
    events: [
      { ticketId: '71273', at: 1, seq: 1, item: { kind: 'system', text: 'Moved to Planning', parentToolUseId: null } },
      { ticketId: '71273', at: 2, seq: 2, item: { kind: 'text', streamId: 'm1', text: 'Half the grid is wired.', parentToolUseId: null } },
    ],
  };
  const sessions = { status: vi.fn(() => status(options.state ?? 'running', options.sessionId === undefined ? 'session-a' : options.sessionId)), stop: vi.fn(async () => ok(options.state === 'none' ? false : true)) };
  const launches = { launch: vi.fn(async (_request: SessionStartRequest) => ok(status('running', 'session-b'))), cancel: vi.fn(() => false) };
  const transcripts = { get: vi.fn(async () => transcript), appendSystem: vi.fn() };
  const stages = { pendingGate: vi.fn(() => null), moveTo: vi.fn(async () => ok({ from: 'planning' as const, to: 'implementing' as const, changed: true })) };
  const service = createAssignAgentService({ sessions, launches, tickets, transcripts, stages, now: () => 5_000 });
  return { tickets, sessions, launches, transcripts, stages, service };
}

describe('assign new agent (AL-263)', () => {
  it('ends the running session, records it as a past session, saves the new model and skills, and hands over with the brief', async () => {
    const { service, tickets, sessions, launches, transcripts } = await setup({ job: 'Cut it over.' });

    const result = await service.assign({ ticketId: '71273', model: 'sonnet', effort: 'high', skills: ['code-review'], mode: 'hand-over' });
    expect(result).toEqual({ ok: true, data: { status: status('running', 'session-b'), previousSessionId: 'session-a' } });

    expect(launches.cancel).toHaveBeenCalledWith('71273');
    expect(sessions.stop).toHaveBeenCalledWith('71273', { reason: SESSION_REPLACED_MESSAGE });
    const record = await tickets.get('71273');
    expect(record).toMatchObject({
      model: 'sonnet',
      effort: 'high',
      skills: ['code-review'],
      sessionId: null,
      pastSessions: [{ sessionId: 'session-a', model: 'opus', effort: 'xhigh', endedAt: 5_000, reason: 'assigned' }],
    });
    expect(transcripts.appendSystem).toHaveBeenCalledWith('71273', 'New agent · Sonnet · High · handed over');

    const launch = launches.launch.mock.calls[0]![0];
    expect(launch.firstTurnSource).toBe('hand-over');
    expect(launch.firstTurnEcho).toBe(HAND_OVER_ECHO);
    expect(launch.jobDescription?.startsWith(`${HAND_OVER_HEADING}: you are taking over`)).toBe(true);
    expect(launch.jobDescription).toContain('The original job:\nCut it over.');
    expect(launch.jobDescription).toContain('Half the grid is wired.');
    expect(launch.workItem).toEqual({ id: 71273, title: 'Cutover frmJobControl to Blazor' });
  });

  it('starts fresh with the original job and no brief, from a lost or ended session, and moves the stage when asked', async () => {
    const { service, launches, stages, tickets } = await setup({ state: 'lost', job: 'Cut it over.' });
    const result = await service.assign({ ticketId: '71273', model: 'opus', effort: 'max', skills: [], stage: 'implementing', mode: 'fresh' });
    expect(result.ok).toBe(true);
    expect(stages.moveTo).toHaveBeenCalledWith('71273', 'implementing', 'the new agent');
    const launch = launches.launch.mock.calls[0]![0];
    expect(launch).toMatchObject({ jobDescription: 'Cut it over.', firstTurnSource: 'launch' });
    expect(launch.firstTurnEcho).toBeUndefined();
    expect((await tickets.get('71273'))?.pastSessions).toHaveLength(1);

    // A second assignment adds to the list; a ticket that never had a session gets no entry.
    const again = await setup({ state: 'none', sessionId: null });
    await again.service.assign({ ticketId: '71273', model: 'haiku', effort: 'low', skills: [], mode: 'fresh' });
    expect((await again.tickets.get('71273'))?.pastSessions).toBeUndefined();
    expect(again.launches.launch.mock.calls[0]![0]).toMatchObject({ jobDescription: 'Continue the work on Cutover frmJobControl to Blazor.' });
  });

  it('says what the divider reads', () => {
    expect(newAgentLine({ model: 'haiku', effort: 'xhigh', mode: 'fresh' })).toBe('New agent · Haiku · XHigh · started fresh');
  });
});
