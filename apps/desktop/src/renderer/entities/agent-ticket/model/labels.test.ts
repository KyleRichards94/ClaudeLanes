import { describe, expect, it } from 'vitest';
import { LANE_LABELS, modelEffortLabel, stageProgressLabel } from './labels';

describe('agent ticket labels', () => {
  it('writes model and effort as on the cards', () => {
    expect(modelEffortLabel('opus', 'xhigh')).toBe('Opus · XHigh');
    expect(modelEffortLabel('sonnet', 'medium')).toBe('Sonnet · Med');
  });

  it('adds progress to a stage only while it runs', () => {
    expect(stageProgressLabel('implementing', 0.456)).toBe('Implementing · 46%');
    expect(stageProgressLabel('implementing', null)).toBe('Implementing');
    expect(stageProgressLabel('done', 1)).toBe('Done');
    expect(LANE_LABELS['code-review']).toBe('Code review');
  });
});
