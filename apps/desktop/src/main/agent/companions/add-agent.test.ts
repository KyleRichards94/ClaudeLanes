import { describe, expect, it, vi } from 'vitest';
import { err, ok, type AgentSessionStatus } from '@agent-lanes/contracts';
import type { SessionStartRequest } from '../session-manager';
import { memoryTickets } from '../testing/sessions';
import { companionBrief, companionId, companionSlug, createAddAgentService } from './add-agent';

const status = (ticketId: string, state: AgentSessionStatus['state'] = 'running'): AgentSessionStatus => ({ ticketId, state, sessionId: null, message: null });

async function setup(options: { launchFails?: boolean } = {}) {
  const tickets = await memoryTickets({ id: '71273' });
  await tickets.update('71273', (record) => ({ ...record, job: 'Cut the form over to Blazor.', stage: 'implementing' }));
  const launches = { launch: vi.fn(async (request: SessionStartRequest) => (options.launchFails ? err('VALIDATION', 'Connect Claude first.') : ok(status(request.ticketId)))) };
  const subWorktrees = {
    create: vi.fn(async (ticketId: string, name: string) => ok({ worktreePath: `C:\\src\\.agent-lanes\\${ticketId}--${name}`, branch: `sub/${ticketId}-${name}`, shared: false, created: true })),
  };
  const transcripts = { appendSystem: vi.fn() };
  const service = createAddAgentService({ tickets, launches, subWorktrees, transcripts });
  return { tickets, launches, subWorktrees, transcripts, service };
}

describe('add agent (AL-266)', () => {
  it('runs a reviewer as a companion record in the lead worktree, read-only, with a brief and the task', async () => {
    const { service, tickets, launches, subWorktrees, transcripts } = await setup();
    const result = await service.add({ ticketId: '71273', role: 'reviewer', name: 'Second pair of eyes', model: 'sonnet', effort: 'high', skills: ['code-review'], prompt: 'Review the grid.' });
    expect(result).toEqual({ ok: true, data: { companionId: '71273-reviewer-second-pair-of-eyes', status: status('71273-reviewer-second-pair-of-eyes') } });

    const lead = (await tickets.get('71273'))!;
    const record = (await tickets.get('71273-reviewer-second-pair-of-eyes'))!;
    expect(record).toMatchObject({
      title: 'Second pair of eyes · Cutover frmJobControl to Blazor',
      ado: null,
      repo: lead.repo,
      baseBranch: 'main',
      branch: lead.branch,
      worktreePath: lead.worktreePath,
      stage: 'implementing',
      model: 'sonnet',
      effort: 'high',
      skills: ['code-review'],
      job: 'Review the grid.',
      companion: { of: '71273', role: 'reviewer', name: 'Second pair of eyes' },
    });
    expect(Object.values(record.gates)).toEqual(['auto', 'auto', 'auto', 'auto', 'auto']);
    expect(subWorktrees.create).not.toHaveBeenCalled();

    const launch = launches.launch.mock.calls[0]![0];
    expect(launch).toMatchObject({ ticketId: '71273-reviewer-second-pair-of-eyes', firstTurnSource: 'launch', firstTurnEcho: 'Review the grid.', workItem: { id: 71273, title: 'Cutover frmJobControl to Blazor' } });
    expect(launch.jobDescription).toContain('You are the reviewer "Second pair of eyes" on work item #71273');
    expect(launch.jobDescription).toContain('You are read-only');
    expect(launch.jobDescription).toContain("The ticket's original job, which the lead agent works on:\nCut the form over to Blazor.");
    expect(launch.jobDescription).toContain('Your task:\nReview the grid.');
    expect(transcripts.appendSystem).toHaveBeenCalledWith('71273', 'Reviewer "Second pair of eyes" added');
  });

  it('gives a helper its own sub-branch and worktree, recorded on the lead like a writer sub-agent', async () => {
    const { service, tickets, launches, subWorktrees, transcripts } = await setup();
    const result = await service.add({ ticketId: '71273', role: 'helper', name: 'Docs', model: 'haiku', effort: 'low', skills: [], prompt: 'Write the release notes.' });
    expect(result.ok).toBe(true);
    expect(subWorktrees.create).toHaveBeenCalledWith('71273', 'docs');
    const record = (await tickets.get('71273-helper-docs'))!;
    expect(record).toMatchObject({ branch: 'sub/71273-docs', worktreePath: 'C:\\src\\.agent-lanes\\71273--docs', baseBranch: '71273-cutover-frmjobcontrol-to', companion: { of: '71273', role: 'helper', name: 'Docs' } });
    const launch = launches.launch.mock.calls[0]![0];
    expect(launch.jobDescription).toContain('You are the helper "Docs"');
    expect(launch.jobDescription).toContain('your own worktree at C:\\src\\.agent-lanes\\71273--docs on branch sub/71273-docs, branched from the ticket branch 71273-cutover-frmjobcontrol-to');
    expect(transcripts.appendSystem).toHaveBeenCalledWith('71273', 'Helper "Docs" added on sub/71273-docs');
  });

  it('refuses a companion of a companion, a taken name and an empty name, and drops the record when the launch fails', async () => {
    const { service, tickets } = await setup();
    await service.add({ ticketId: '71273', role: 'reviewer', name: 'Eyes', model: 'sonnet', effort: 'high', skills: [], prompt: 'Review.' });
    const again = await service.add({ ticketId: '71273', role: 'reviewer', name: 'eyes!', model: 'sonnet', effort: 'high', skills: [], prompt: 'Review.' });
    expect(again).toMatchObject({ ok: false, code: 'VALIDATION', details: { reason: 'name-taken' } });
    const nested = await service.add({ ticketId: '71273-reviewer-eyes', role: 'helper', name: 'Sub', model: 'sonnet', effort: 'high', skills: [], prompt: 'x' });
    expect(nested).toMatchObject({ ok: false, details: { reason: 'not-a-lead' } });
    expect(await service.add({ ticketId: '71273', role: 'helper', name: '!!!', model: 'sonnet', effort: 'high', skills: [], prompt: 'x' })).toMatchObject({ ok: false, details: { reason: 'invalid-name' } });

    const failing = await setup({ launchFails: true });
    const failed = await failing.service.add({ ticketId: '71273', role: 'reviewer', name: 'Eyes', model: 'sonnet', effort: 'high', skills: [], prompt: 'Review.' });
    expect(failed).toMatchObject({ ok: false, message: 'Connect Claude first.' });
    expect(await failing.tickets.get('71273-reviewer-eyes')).toBeUndefined();
    expect(await tickets.get('71273-reviewer-eyes')).toBeDefined();
  });

  it('makes ids and slugs that fit the ticket id rules', () => {
    expect(companionSlug('  Second Pair of Eyes! ')).toBe('second-pair-of-eyes');
    expect(companionId('71273', 'helper', 'Docs & notes')).toBe('71273-helper-docs-notes');
    expect(companionId('71273', 'reviewer', 'x'.repeat(100))).toHaveLength(64);
    expect(companionId('71273', 'reviewer', 'x'.repeat(100))).not.toMatch(/-$/);
  });

  it('writes the brief without a job when the lead has none', () => {
    const lead = { id: 'nt-notes', title: 'Notes', ado: null, branch: 'nt-notes', worktreePath: 'C:\\w' } as never;
    const brief = companionBrief(lead, 'helper', 'Docs', 'Write them.', { worktreePath: 'C:\\w--docs', branch: 'sub/nt-notes-docs' });
    expect(brief).toContain('on ticket nt-notes "Notes"');
    expect(brief).not.toContain('original job');
    expect(brief.endsWith('Your task:\nWrite them.')).toBe(true);
  });
});
