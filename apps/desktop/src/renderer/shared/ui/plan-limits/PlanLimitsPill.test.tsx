import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { emptyPlanLimits, formatResetTime, planLimitsLabel, type PlanLimits } from '@agent-lanes/contracts';
import { installFakeBridge } from '@/shared/testing';
import { PlanLimitsPill, planLimitsView } from './PlanLimitsPill';

const NOW = new Date(2026, 9, 9, 14, 0).getTime();
const limits: PlanLimits = {
  ...emptyPlanLimits(),
  available: true,
  fiveHour: { utilization: 62, resetsAt: NOW + 80 * 60_000 },
  sevenDay: { utilization: 31, resetsAt: NOW + 3 * 24 * 3_600_000 },
  updatedAt: NOW,
};

describe('plan limits meter (AL-258)', () => {
  it('words the windows and reset times', () => {
    expect(planLimitsLabel(limits)).toBe('5h 62% · 7d 31%');
    expect(formatResetTime(NOW + 80 * 60_000, NOW)).toBe('resets 15:20');
    expect(formatResetTime(NOW + 19 * 3_600_000, NOW)).toBe('resets tomorrow 09:00');
    expect(planLimitsView(limits, NOW)).toMatchObject({ label: '5h 62% · 7d 31%', tone: 'ok', hint: '5-hour window resets 15:20 · 7-day window resets 12 Oct 14:00' });
    expect(planLimitsView({ ...limits, fiveHour: { utilization: 91, resetsAt: null } }, NOW).tone).toBe('danger');
    expect(planLimitsView({ ...limits, status: 'allowed_warning' }, NOW).tone).toBe('attention');
    expect(planLimitsView(emptyPlanLimits(), NOW).visible).toBe(false);
  });

  it('shows the meter once limits are known, with the reset times on hover', async () => {
    installFakeBridge({ 'agent:getPlanLimits': { ok: true, data: { ...limits, waitingTickets: ['71273'] } } });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <PlanLimitsPill />
      </QueryClientProvider>,
    );
    expect((await screen.findByTestId('plan-limits-pill-label')).textContent).toBe('5h 62% · 7d 31%');
    fireEvent.focus(screen.getByTestId('plan-limits-pill'));
    expect(screen.getByRole('tooltip').textContent).toContain('Waiting for the reset: #71273');
  });
});
