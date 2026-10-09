import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { emptyAgentUsage, type AgentUsage } from '@agent-lanes/contracts';
import { UsageStrip, contextTone, usageStripDetails, usageStripLabel } from './UsageStrip';

const usage: AgentUsage = {
  ...emptyAgentUsage('71273'),
  totalTokens: 400_000,
  inputTokens: 300_000,
  outputTokens: 20_000,
  cacheReadInputTokens: 70_000,
  cacheCreationInputTokens: 10_000,
  turnTokens: 12_000,
  costUsd: 1.24,
  turns: 3,
  context: { usedTokens: 150_000, maxTokens: 200_000, percentage: 75 },
  updatedAt: 1,
};

describe('UsageStrip (AL-257)', () => {
  it('turns amber from 70% and red from 90%', () => {
    expect(contextTone(10)).toBe('ok');
    expect(contextTone(70)).toBe('attention');
    expect(contextTone(90)).toBe('danger');
  });

  it('counts the turn in progress in the label and lists the breakdown on hover', () => {
    expect(usageStripLabel(usage)).toBe('412k tokens · $1.24');
    expect(usageStripDetails(usage)).toBe('Input 300k tokens · Output 20k tokens · Cache read 70k tokens · Cache write 10k tokens · This turn so far 12k tokens · Context 150k tokens of 200k');
    render(<UsageStrip usage={usage} />);
    expect(screen.getByTestId('usage-strip-label').textContent).toBe('412k tokens · $1.24');
    expect(screen.getByRole('progressbar', { name: 'Context window' }).getAttribute('aria-valuenow')).toBe('75');
    fireEvent.focus(screen.getByTestId('usage-strip'));
    expect(screen.getByRole('tooltip').textContent).toContain('This turn so far 12k tokens');
  });

  it('draws nothing before the session has used anything', () => {
    render(<UsageStrip usage={emptyAgentUsage('71273')} />);
    expect(screen.queryByTestId('usage-strip')).toBeNull();
  });
});
