import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ok, type AgentSessionStatus, type PlanLimits } from '@agent-lanes/contracts';
import { describe, expect, it, vi } from 'vitest';
import { LIMIT_RESET_MESSAGE, createPlanLimitsService, resetsAtMs } from './plan-limits';
import type { SessionMessageListener } from './session-manager';
import { recordingEmit } from './testing/sessions';

const NOW = Date.UTC(2026, 9, 9, 4, 0, 0);

function fakeSessions() {
  const listeners = new Set<SessionMessageListener>();
  const sent: Array<{ ticketId: string; text: string }> = [];
  return {
    subscribe(listener: SessionMessageListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send(ticketId: string, message: { text: string }) {
      sent.push({ ticketId, text: message.text });
      return ok({ held: false });
    },
    status: (ticketId: string): AgentSessionStatus => ({ ticketId, state: 'idle', sessionId: 's', message: null }),
    deliver(ticketId: string, message: SDKMessage) {
      for (const listener of listeners) listener({ ticketId, cwd: 'C:/wt', resumed: false, message });
    },
    sent,
  };
}

function rateLimit(info: Record<string, unknown>): SDKMessage {
  return { type: 'rate_limit_event', rate_limit_info: info, uuid: 'r', session_id: 's' } as unknown as SDKMessage;
}

function setup(holdPercent = 85) {
  const sessions = fakeSessions();
  const events = recordingEmit();
  const timers: Array<{ callback: () => void; ms: number }> = [];
  const onChange = vi.fn();
  const service = createPlanLimitsService({
    sessions,
    emit: events.emit,
    holdPercent: () => holdPercent,
    onChange,
    now: () => NOW,
    setTimer: (callback, ms) => {
      timers.push({ callback, ms });
      return {};
    },
    clearTimer: () => undefined,
  });
  const limits = () => events.of('agent:planLimits').at(-1)?.['limits'] as PlanLimits | undefined;
  return { sessions, events, timers, onChange, service, limits };
}

describe('plan limits (AL-258)', () => {
  it('reads seconds or milliseconds as a reset time', () => {
    expect(resetsAtMs(1_791_600_000)).toBe(1_791_600_000_000);
    expect(resetsAtMs(1_791_600_000_000)).toBe(1_791_600_000_000);
    expect(resetsAtMs(undefined)).toBeNull();
  });

  it('keeps both windows from the events and tells the launch queue when they change', () => {
    const { sessions, service, limits, onChange } = setup();
    expect(service.get()).toMatchObject({ available: false, status: 'allowed' });
    sessions.deliver('71273', rateLimit({ status: 'allowed', rateLimitType: 'five_hour', utilization: 62, resetsAt: (NOW + 3_600_000) / 1000 }));
    sessions.deliver('71274', rateLimit({ status: 'allowed', rateLimitType: 'seven_day', utilization: 31 }));
    expect(limits()).toMatchObject({ available: true, fiveHour: { utilization: 62, resetsAt: NOW + 3_600_000 }, sevenDay: { utilization: 31, resetsAt: null }, status: 'allowed' });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(service.holdReason()).toBeNull();
  });

  it('warns once per window reset and holds launches above the threshold', () => {
    const { sessions, service, events } = setup(85);
    const resetsAt = (NOW + 1_800_000) / 1000;
    sessions.deliver('71273', rateLimit({ status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 87, resetsAt }));
    sessions.deliver('71274', rateLimit({ status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 88, resetsAt }));
    const toasts = events.of('toast');
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ tone: 'warning', title: 'Plan limit nearly used', body: expect.stringContaining('5-hour window at 87%') });
    expect(service.holdReason()).toMatch(/^Waiting for plan limit · 5-hour window at 88% · resets /);
  });

  it('parks a rejected agent with the reset time on its status and resumes it at the reset', () => {
    const { sessions, service, events, timers, limits } = setup();
    const resetsAt = NOW + 600_000;
    sessions.deliver('71273', rateLimit({ status: 'rejected', rateLimitType: 'five_hour', utilization: 100, resetsAt: resetsAt / 1000 }));
    expect(limits()?.waitingTickets).toEqual(['71273']);
    expect(events.of('agent:status', '71273').at(-1)).toMatchObject({ state: 'idle', message: expect.stringMatching(/^Waiting for limit reset · resets \d\d:\d\d$/) });
    expect(service.holdReason()).toMatch(/^Waiting for the plan limit to reset/);
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(602_000);

    timers[0]!.callback();
    expect(limits()?.waitingTickets).toEqual([]);
    expect(limits()?.status).toBe('allowed');
    expect(sessions.sent).toEqual([{ ticketId: '71273', text: LIMIT_RESET_MESSAGE }]);
    expect(events.of('agent:status', '71273').at(-1)).toMatchObject({ message: null });
  });

  it('stops listening on dispose', () => {
    const { sessions, service, limits } = setup();
    service.dispose();
    sessions.deliver('71273', rateLimit({ status: 'allowed', rateLimitType: 'five_hour', utilization: 10 }));
    expect(limits()).toBeUndefined();
  });
});
