import { LANES, STAGES, defaultStageGates, type Lane, type Stage } from '@agent-lanes/contracts';
import { describe, expect, it } from 'vitest';
import { allowedNextStages, checkStageTransition, gateFor } from './stage-rules';

describe('stage rules (AL-103, design §9)', () => {
  const allowed: Array<[Lane, Stage]> = [
    ['queued', 'planning'],
    ['planning', 'implementing'],
    ['implementing', 'code-review'],
    ['code-review', 'qa'],
    ['qa', 'create-pr'],
    // Review issues or a QA gap send the work back.
    ['code-review', 'implementing'],
    ['qa', 'implementing'],
  ];

  it.each(allowed)('allows %s → %s', (from, to) => {
    expect(checkStageTransition(from, to)).toEqual({ ok: true, changed: true });
  });

  it('rejects every other move, saying where the agent can go', () => {
    const allowedPairs = new Set(allowed.map(([from, to]) => `${from}>${to}`));
    for (const from of LANES) {
      for (const to of STAGES) {
        if (from === to || allowedPairs.has(`${from}>${to}`)) continue;
        const check = checkStageTransition(from, to);
        expect(check.ok, `${from} → ${to}`).toBe(false);
      }
    }
    expect(checkStageTransition('planning', 'qa')).toEqual({
      ok: false,
      reason:
        'Cannot move from Planning to QA. From Planning you can move to "implementing" (Implementing). Stages go one step forward at a time; Code review and QA may send the work back to Implementing.',
    });
    expect(checkStageTransition('create-pr', 'implementing')).toMatchObject({ ok: false, reason: expect.stringContaining('you can move to no other stage') });
  });

  it('treats the current stage as no move', () => {
    expect(checkStageTransition('implementing', 'implementing')).toEqual({ ok: true, changed: false });
  });

  it('lists the next stages for each lane', () => {
    expect(allowedNextStages('qa')).toEqual(['create-pr', 'implementing']);
    expect(allowedNextStages('done')).toEqual([]);
  });
});

describe('which gate a move waits on (AL-104, design §9 step 2)', () => {
  const defaults = defaultStageGates();
  const everything = Object.fromEntries(STAGES.map((stage) => [stage, 'approval'])) as ReturnType<typeof defaultStageGates>;
  const nothing = Object.fromEntries(STAGES.map((stage) => [stage, 'auto'])) as ReturnType<typeof defaultStageGates>;

  it('holds Planning → Implementing for plan approval and the move into Create PR for PR approval by default', () => {
    expect(gateFor(defaults, 'planning', 'implementing')).toBe('planning');
    expect(gateFor(defaults, 'implementing', 'code-review')).toBeNull();
    expect(gateFor(defaults, 'code-review', 'qa')).toBeNull();
    expect(gateFor(defaults, 'qa', 'create-pr')).toBe('create-pr');
  });

  it('gates leaving a stage set to Needs approval, never going back or starting', () => {
    expect(gateFor(everything, 'implementing', 'code-review')).toBe('implementing');
    expect(gateFor(everything, 'code-review', 'qa')).toBe('code-review');
    expect(gateFor(everything, 'code-review', 'implementing')).toBeNull();
    expect(gateFor(everything, 'qa', 'implementing')).toBeNull();
    expect(gateFor(everything, 'queued', 'planning')).toBeNull();
  });

  it('lets everything through when every stage is Auto', () => {
    expect(gateFor(nothing, 'planning', 'implementing')).toBeNull();
    expect(gateFor(nothing, 'qa', 'create-pr')).toBeNull();
    expect(gateFor({ ...nothing, qa: 'approval' }, 'qa', 'create-pr')).toBe('qa');
  });
});
