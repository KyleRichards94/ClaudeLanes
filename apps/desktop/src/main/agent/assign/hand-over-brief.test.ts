import { describe, expect, it } from 'vitest';
import type { AgentOutputEvent, GitDiff, TicketRecord } from '@agent-lanes/contracts';
import { memoryTickets } from '../testing/sessions';
import { HAND_OVER_BRIEF_LIMIT, HAND_OVER_HEADING, buildHandOverBrief } from './hand-over-brief';

const lead = { parentToolUseId: null };

function event(seq: number, item: AgentOutputEvent['item']): AgentOutputEvent {
  return { ticketId: '71273', at: 1_000 + seq, seq, item };
}

async function record(): Promise<TicketRecord> {
  const tickets = await memoryTickets({ id: '71273' });
  const saved = await tickets.get('71273');
  if (!saved) throw new Error('no record');
  return {
    ...saved,
    stage: 'implementing',
    stageHistory: [
      { stage: 'queued', at: 1 },
      { stage: 'planning', at: 2 },
      { stage: 'implementing', at: 3 },
    ],
    job: 'Cut frmJobControl over to Blazor. Keep the WinForms child modals.',
  };
}

const diff: GitDiff = {
  ticketId: '71273',
  against: { kind: 'base' },
  fromRef: 'main',
  fromCommit: 'abc123',
  toRef: '71273-cutover-frmjobcontrol-to',
  includesUncommitted: true,
  files: [
    { path: 'src/JobGrid.razor', oldPath: null, status: 'added', additions: 214, deletions: 0, binary: false },
    { path: 'src/JobControl.vb', oldPath: null, status: 'modified', additions: 3, deletions: 40, binary: false },
    { path: 'assets/logo.png', oldPath: null, status: 'added', additions: null, deletions: null, binary: true },
  ],
  truncated: false,
};

describe('hand-over brief (AL-263)', () => {
  it('tells the new agent the ticket, the job, the stages, the gate, what happened, the diff and the last messages', async () => {
    const brief = buildHandOverBrief({
      record: await record(),
      events: [
        event(1, { kind: 'system', text: 'Moved to Planning', ...lead }),
        event(2, { kind: 'text', streamId: 'm1', text: 'I mapped the four child modals.', ...lead }),
        event(3, { kind: 'text', streamId: 'm2', text: 'A sub-agent said this', parentToolUseId: 'toolu_sub' }),
        event(4, { kind: 'system', text: 'Plan approved by Kyle · moved to Implementing', ...lead }),
        event(5, { kind: 'text', streamId: 'm3', text: 'Wiring the grid filters now.', ...lead }),
      ],
      diff,
      pendingGate: { stage: 'code-review', from: 'implementing', to: 'code-review', summary: 'Grid follows Design v1', openedAt: 9 },
    });

    expect(brief.startsWith(`${HAND_OVER_HEADING}: you are taking over Agent Lanes ticket 71273 (Cutover frmJobControl to Blazor)`)).toBe(true);
    expect(brief).toContain('Work item: Azure DevOps #71273 in OnSite Companion.');
    expect(brief).toContain('The original job:\nCut frmJobControl over to Blazor. Keep the WinForms child modals.');
    expect(brief).toContain('Stage now: Implementing (so far: Queued → Planning → Implementing).');
    expect(brief).toContain("A gate was open: Code review waited for the user's approval to move to Code review — Grid follows Design v1.");
    expect(brief).toContain("What happened, from the ticket's output:\n- Moved to Planning\n- Plan approved by Kyle · moved to Implementing");
    expect(brief).toContain('Changes against main: 3 files, +217 −40 (uncommitted changes included).\n- added src/JobGrid.razor (+214 −0)\n- modified src/JobControl.vb (+3 −40)\n- added assets/logo.png');
    // Only the lead agent's messages, oldest first; sub-agent text stays out.
    expect(brief).toContain("The previous agent's last 2 messages, oldest first:\n---\nI mapped the four child modals.\n---\nWiring the grid filters now.\n---");
    expect(brief).not.toContain('A sub-agent said this');
    expect(brief.endsWith('report your stage with set_stage as before.')).toBe(true);
  });

  it('copes with no work item, no job, no diff, no gate and no output, and clips a long brief', async () => {
    const base = await record();
    const { job: _job, ...withoutJob } = base;
    const bare = buildHandOverBrief({ record: { ...withoutJob, ado: null }, events: [], diff: null, pendingGate: null });
    expect(bare).toContain('The ticket has no Azure DevOps work item.');
    expect(bare).not.toContain('The original job');
    expect(bare).not.toContain('Changes against');
    expect(bare).not.toContain("previous agent's last");

    const long = buildHandOverBrief({ record: base, events: [event(1, { kind: 'text', streamId: 'm', text: 'x'.repeat(30_000), ...lead })], diff: null, pendingGate: null });
    expect(long.length).toBeLessThanOrEqual(HAND_OVER_BRIEF_LIMIT);
    expect(long).toContain(`${'x'.repeat(1_499)}…`);
  });
});
