import { describe, expect, it } from 'vitest';
import { WORK_ITEM_DESCRIPTION_LIMIT, buildFirstTurn, plainText } from './first-turn';

describe('first user turn (AL-100)', () => {
  it('turns ADO description HTML into text', () => {
    expect(plainText('<div>Move the <b>grid</b>&nbsp;&amp; filters</div><ul><li>one</li><li>two</li></ul>')).toBe('Move the grid & filters\n- one\n- two');
  });

  it('names the work item, the job and the skills', () => {
    const text = buildFirstTurn({
      ticketId: '71273',
      title: 'Cutover frmJobControl to Blazor',
      jobDescription: '  Cut it over.  ',
      workItem: { id: 71273, title: 'Cutover frmJobControl to Blazor', type: 'User Story', state: 'Active', description: '<p>Details</p>' },
      skills: ['osc-blazor-cutover-invoke', 'code-review'],
      appendix: ['Stage protocol goes here.'],
    });
    expect(text).toBe(
      [
        'You are working on Azure DevOps work item #71273: Cutover frmJobControl to Blazor (User Story · Active).',
        'Work item description:\nDetails',
        'What to do:\nCut it over.',
        'Use these skills where they fit: /osc-blazor-cutover-invoke, /code-review.',
        'Stage protocol goes here.',
      ].join('\n\n'),
    );
  });

  it('says when there is no work item, and clips a long description', () => {
    expect(buildFirstTurn({ ticketId: 'nt-20261007-fix-login', title: 'Fix the login', jobDescription: 'Fix it', skills: [] })).toBe(
      'You are working on the Agent Lanes ticket nt-20261007-fix-login: Fix the login. It has no Azure DevOps work item.\n\nWhat to do:\nFix it',
    );
    const long = buildFirstTurn({ ticketId: '1', title: 't', jobDescription: 'j', skills: [], workItem: { id: 1, title: 't', description: 'x'.repeat(WORK_ITEM_DESCRIPTION_LIMIT + 50) } });
    expect(long).toContain(`${'x'.repeat(WORK_ITEM_DESCRIPTION_LIMIT)}…`);
    expect(long).not.toContain('x'.repeat(WORK_ITEM_DESCRIPTION_LIMIT + 1));
  });
});
