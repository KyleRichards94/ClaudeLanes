import { describe, expect, it } from 'vitest';
import { emptyAgentUsage, formatTokenCount } from '@agent-lanes/contracts';
import { folderName, formatClock, formatDuration, sessionPillLabel, sessionUsageDetails, sprintName } from './format';
import { sessionStartedAt, stageSteps } from './stage-steps';

describe('drill-in formatting', () => {
  it('writes durations as on the stepper and session pill', () => {
    expect(formatDuration(30_000)).toBe('<1m');
    expect(formatDuration(12 * 60_000)).toBe('12m');
    expect(formatDuration(72 * 60_000)).toBe('1h 12m');
    expect(formatDuration(27 * 3_600_000)).toBe('1d 3h');
  });

  it('writes clock times, folder and sprint names', () => {
    expect(formatClock(new Date(2026, 9, 7, 14, 2).getTime())).toBe('14:02');
    expect(folderName('C:\\src\\onsite-companion')).toBe('onsite-companion');
    expect(folderName('/home/kyle/src/repo/')).toBe('repo');
    expect(sprintName('OnSite Companion\\Sprint 42')).toBe('Sprint 42');
  });
});

describe('stageSteps', () => {
  const history = [
    { stage: 'queued' as const, at: 0 },
    { stage: 'planning' as const, at: 1_000 },
    { stage: 'implementing' as const, at: 1_000 + 12 * 60_000 },
  ];

  it('marks done, current and upcoming steps with finished durations', () => {
    expect(stageSteps('implementing', history)).toEqual([
      { stage: 'planning', state: 'done', durationMs: 12 * 60_000 },
      { stage: 'implementing', state: 'current', durationMs: null },
      { stage: 'code-review', state: 'upcoming', durationMs: null },
      { stage: 'qa', state: 'upcoming', durationMs: null },
      { stage: 'create-pr', state: 'upcoming', durationMs: null },
    ]);
  });

  it('has every step upcoming while queued and done once merged', () => {
    expect(stageSteps('queued', [{ stage: 'queued', at: 0 }]).every((step) => step.state === 'upcoming')).toBe(true);
    expect(stageSteps('done', history).every((step) => step.state === 'done')).toBe(true);
  });

  it('dates the session from its first stage', () => {
    expect(sessionStartedAt(history)).toBe(1_000);
    expect(sessionStartedAt([{ stage: 'queued', at: 0 }])).toBeNull();
  });
});

describe('session usage formatting (AL-113)', () => {
  const usage = { ...emptyAgentUsage('71273'), totalTokens: 412_000, costUsd: 0.004, turns: 1 };

  it('adds the tokens to the session pill once there are any', () => {
    expect(sessionPillLabel('cc-71273', 0, 72 * 60_000, usage)).toBe('Session cc-71273 · 1h 12m · 412k tokens');
    expect(sessionPillLabel('cc-71273', null, 0, { totalTokens: 0 })).toBe('Session cc-71273');
    expect(formatTokenCount(1_250_000)).toBe('1.3M tokens');
    expect(formatTokenCount(999_700)).toBe('1M tokens');
  });

  it('puts the cost and context in the tooltip text', () => {
    expect(sessionUsageDetails(usage)).toBe('Cost about <$0.01 · 1 turn');
    expect(sessionUsageDetails(emptyAgentUsage('x'))).toBeNull();
  });
});
