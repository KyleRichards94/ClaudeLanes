import { describe, expect, it } from 'vitest';
import { ticketFromRecord, type AgentTicket } from '@/entities/agent-ticket';
import { fakeTicketRecord } from '@/shared/testing';
import { QUIET_AFTER_MS, boardDigest, digestEntry, digestText } from './digest';

const NOW = 1_760_000_000_000;

function ticket(id: string, fields: Partial<AgentTicket> = {}): AgentTicket {
  return { ...ticketFromRecord(fakeTicketRecord({ id, stage: 'implementing', stageEnteredAt: NOW - 10_000 })), ...fields };
}

describe('board digest (AL-272)', () => {
  it('ranks what needs you first, then stopped agents, failed builds, finished work, quiet ones, then the rest', () => {
    const entries = boardDigest(
      [
        ticket('71100', { session: 'running', lastOutputAt: NOW - 1_000, activity: { text: 'Wiring the grid', at: NOW } }),
        ticket('71101', { session: 'running', lastOutputAt: NOW - QUIET_AFTER_MS - 1 }),
        ticket('71102', { session: 'stopped', lastOutputAt: NOW - 5_000, stage: 'create-pr' }),
        ticket('71103', { session: 'lost', lastOutputAt: NOW - 5_000 }),
        ticket('71104', { session: 'running', lastOutputAt: NOW, needsYou: [{ kind: 'approval', stage: 'planning', since: 1 }], gate: { stage: 'planning', openedAt: 1, summary: 'Plan ready' } }),
        ticket('71105', { session: 'running', lastOutputAt: NOW, build: { job: null, last: { outcome: 'failed', startedAt: 1, finishedAt: 2, errors: 3, warnings: 0, firstError: null } } }),
        ticket('71106', { stage: 'queued' }),
        ticket('71107', { stage: 'done', activity: { text: 'Merged into main · 15:20', at: NOW } }),
      ],
      NOW,
    );
    expect(entries.map((entry) => [entry.ticketId, entry.kind])).toEqual([
      ['71104', 'needs-you'],
      ['71103', 'dead'],
      ['71105', 'build-failed'],
      ['71102', 'finished'],
      ['71101', 'quiet'],
      ['71106', 'queued'],
      ['71100', 'working'],
      ['71107', 'done'],
    ]);
    expect(entries[0]).toMatchObject({ label: '#71104', reasons: ['Waiting for you · approve planning · Plan ready'], action: 'open' });
    expect(entries[1]).toMatchObject({ reasons: ['Session lost'], action: 'resume' });
    expect(entries[2]!.reasons).toEqual(['Build failed · 3 errors']);
    expect(entries[3]!.reasons).toEqual(['Agent finished', 'Ready to merge or open a PR']);
    expect(entries[4]!.reasons).toEqual(['Quiet for 2 h']);
    expect(entries[6]!.reasons).toEqual(['Wiring the grid']);
  });

  it('names PR state and review activity, and writes the text the model reads', () => {
    const entry = digestEntry(
      ticket('pr-11635-review', { ado: null, stage: 'code-review', session: 'idle', lastOutputAt: NOW, prActivity: { comments: 4, threads: 0, updatedAt: NOW }, pullRequest: { id: 11635, status: 'active', checks: { passed: 3, total: 4, pending: 1 } } }),
      NOW,
    );
    expect(entry).toMatchObject({ label: 'pr-11635-review', kind: 'working', reasons: ['PR !11635 active · 3/4 checks', '4 comments posted'] });
    expect(digestText([entry])).toBe('- pr-11635-review "Cutover frmJobControl to Blazor" · Code review · Working · PR !11635 active · 3/4 checks · 4 comments posted');
    expect(digestText([])).toBe('The agent board is empty.');
  });
});
