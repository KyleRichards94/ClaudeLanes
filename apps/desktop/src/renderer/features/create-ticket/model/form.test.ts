import { defaultAgentDefaults } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { initialForm, launchRequest, launchSummary, newTicketReducer, validateForm, type NewTicketAction } from './form';

const defaults = { ...defaultAgentDefaults(), skills: ['code-review'] };
const run = (...actions: NewTicketAction[]) => actions.reduce(newTicketReducer, initialForm(defaults));
const item = { id: 71273, title: 'Cutover frmJobControl to Blazor', type: 'Story', state: 'Active' };

describe('new ticket form', () => {
  it('starts from the agent defaults in settings', () => {
    expect(initialForm(defaults)).toEqual({
      source: 'sprint',
      workItem: null,
      description: '',
      skills: ['code-review'],
      model: 'opus',
      effort: 'xhigh',
      gates: defaults.stageGates,
      worktreeName: null,
    });
  });

  it('needs a work item unless "No ticket" is chosen, and then a description', () => {
    expect(validateForm(run())).toEqual({ workItem: 'Pick a work item, or choose No ticket.' });
    expect(validateForm(run({ type: 'workItem', workItem: item }))).toEqual({});
    expect(validateForm(run({ type: 'source', source: 'none' }))).toEqual({
      description: 'Describe the job: a ticket without a work item starts from this.',
    });
    expect(validateForm(run({ type: 'source', source: 'none' }, { type: 'description', description: '   ' }))).toHaveProperty('description');
    expect(validateForm(run({ type: 'source', source: 'none' }, { type: 'description', description: 'Fix the login' }))).toEqual({});
  });

  it('drops the picked item when switching to "No ticket" and refuses one while there', () => {
    const none = run({ type: 'workItem', workItem: item }, { type: 'source', source: 'none' });
    expect(none.workItem).toBeNull();
    expect(newTicketReducer(none, { type: 'workItem', workItem: item }).workItem).toBeNull();
    expect(run({ type: 'workItem', workItem: item }, { type: 'source', source: 'search' }).workItem).toEqual(item);
  });

  it('toggles skills once each and keeps other changes', () => {
    const form = run(
      { type: 'skill', skill: 'cs-qa-wip', selected: true },
      { type: 'skill', skill: 'cs-qa-wip', selected: true },
      { type: 'skill', skill: 'code-review', selected: false },
      { type: 'model', model: 'sonnet' },
      { type: 'effort', effort: 'high' },
      { type: 'gate', stage: 'qa', gate: 'approval' },
      { type: 'worktreeName', name: '71273-grid' },
    );
    expect(form).toMatchObject({ skills: ['cs-qa-wip'], model: 'sonnet', effort: 'high', worktreeName: '71273-grid' });
    expect(form.gates.qa).toBe('approval');
    expect(newTicketReducer(form, { type: 'reset', defaults })).toEqual(initialForm(defaults));
  });

  it('builds the launch request from a valid form only', () => {
    expect(launchRequest(run())).toEqual({ ok: false, errors: { workItem: 'Pick a work item, or choose No ticket.' } });
    expect(launchRequest(run({ type: 'workItem', workItem: item }, { type: 'description', description: '  Keep the WinForms modals.  ' }))).toEqual({
      ok: true,
      request: {
        workItem: item,
        description: 'Keep the WinForms modals.',
        skills: ['code-review'],
        model: 'opus',
        effort: 'xhigh',
        gates: defaults.stageGates,
        worktreeName: null,
      },
    });
  });

  it('writes the footer summary', () => {
    expect(launchSummary(run({ type: 'workItem', workItem: item }))).toBe(
      'Launch starts a headless Claude Code session in its own worktree via the MCP bridge. Linked to #71273. Opus · XHigh.',
    );
    expect(launchSummary(run({ type: 'source', source: 'none' }, { type: 'model', model: 'haiku' }, { type: 'effort', effort: 'low' }))).toBe(
      'Launch starts a headless Claude Code session in its own worktree via the MCP bridge. No work item linked. Haiku · Low.',
    );
  });
});
