import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { emptyPlanLimits, formatResetTime, type PlanLimitWindowKind, type PlanLimits } from '@agent-lanes/contracts';
import type { Emit } from '../ipc/emit';
import type { Logger } from '../logging';
import type { SessionManager } from './session-manager';

/**
 * The claude.ai plan's rate limits (AL-258): every session's `rate_limit_event` messages feed one
 * shared picture of the 5-hour and 7-day windows, pushed as `agent:planLimits` for the header meter.
 *
 * - `allowed_warning` raises one warning toast per window reset.
 * - `rejected`: the ticket's agent is parked with "Waiting for limit reset · resets 15:20" on its
 *   status, and at the reset it is sent a continue turn, so the ticket resumes instead of failing.
 * - The launch queue asks `holdReason()` before starting a launch: above the Settings threshold of
 *   the 5-hour window new launches wait in Queued (Kyle, 2026-10-09: 85%).
 */
export interface PlanLimitsService {
  get(): PlanLimits;
  /** Why a new launch should wait, or null when it may start. */
  holdReason(): string | null;
  dispose(): void;
}

export interface PlanLimitsServiceOptions {
  sessions: Pick<SessionManager, 'subscribe' | 'send' | 'status'>;
  emit: Emit;
  /** The 5-hour share above which new launches wait (`launchHoldPercent`), read at each decision. */
  holdPercent: () => number;
  /** The limits changed: the launch queue should look again at what it holds. */
  onChange?: () => void;
  log?: Pick<Logger, 'info' | 'warn'>;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => { unref?(): void };
  clearTimer?: (handle: unknown) => void;
}

/** Sent to a parked agent once its window reset. */
export const LIMIT_RESET_MESSAGE = 'The plan limit that paused you has reset. Continue where you left off.';
export const PLAN_LIMIT_WARNING_TITLE = 'Plan limit nearly used';

interface RateLimitInfo {
  status?: string;
  resetsAt?: number;
  rateLimitType?: string;
  utilization?: number;
}

/** Epoch milliseconds from a timestamp that may be in seconds (Claude Code reports Unix seconds). */
export function resetsAtMs(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value < 1e12 ? value * 1000 : value);
}

function windowOf(type: string | undefined): PlanLimitWindowKind | null {
  switch (type) {
    case 'five_hour':
    case 'seven_day':
    case 'seven_day_opus':
    case 'seven_day_sonnet':
    case 'overage':
      return type;
    case 'seven_day_overage_included':
      return 'seven_day';
    default:
      return null;
  }
}

export function createPlanLimitsService(options: PlanLimitsServiceOptions): PlanLimitsService {
  const { sessions, emit, log } = options;
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as NodeJS.Timeout));
  let limits: PlanLimits = emptyPlanLimits();
  const warned = new Set<string>();
  const timers = new Map<string, unknown>();

  function publish(change: Partial<PlanLimits>): void {
    limits = { ...limits, ...change, updatedAt: now() };
    emit('agent:planLimits', { limits });
    options.onChange?.();
  }

  function parkedMessage(resetsAt: number | null): string {
    return resetsAt ? `Waiting for limit reset · ${formatResetTime(resetsAt, now())}` : 'Waiting for the plan limit to reset';
  }

  function park(ticketId: string, resetsAt: number | null): void {
    if (!limits.waitingTickets.includes(ticketId)) publish({ waitingTickets: [...limits.waitingTickets, ticketId] });
    emit('agent:status', { ...sessions.status(ticketId), message: parkedMessage(resetsAt) });
    log?.warn(`Ticket ${ticketId} hit a plan limit; waiting for the reset${resetsAt ? ` at ${new Date(resetsAt).toISOString()}` : ''}`);
    const existing = timers.get(ticketId);
    if (existing !== undefined) clearTimer(existing);
    // Without a reset time, try again in five minutes.
    const delay = Math.max(1_000, (resetsAt ?? now() + 5 * 60_000) - now() + 2_000);
    const handle = setTimer(() => release(ticketId), delay);
    (handle as { unref?(): void }).unref?.();
    timers.set(ticketId, handle);
  }

  function release(ticketId: string): void {
    timers.delete(ticketId);
    if (!limits.waitingTickets.includes(ticketId)) return;
    publish({ waitingTickets: limits.waitingTickets.filter((id) => id !== ticketId), status: 'allowed' });
    const status = sessions.status(ticketId);
    emit('agent:status', { ...status, message: null });
    const sent = sessions.send(ticketId, { text: LIMIT_RESET_MESSAGE, source: 'app' });
    if (sent.ok) log?.info(`Ticket ${ticketId} resumes after the plan limit reset`);
    else log?.warn(`Ticket ${ticketId} could not resume after the plan limit reset: ${sent.message}`);
  }

  function handle(ticketId: string, message: SDKMessage): void {
    if (message.type !== 'rate_limit_event') return;
    const info = (message as { rate_limit_info?: RateLimitInfo }).rate_limit_info ?? {};
    const kind = windowOf(info.rateLimitType);
    const resetsAt = resetsAtMs(info.resetsAt);
    const utilization = typeof info.utilization === 'number' && Number.isFinite(info.utilization) ? Math.min(100, Math.max(0, info.utilization)) : null;
    const status = info.status === 'allowed_warning' || info.status === 'rejected' ? info.status : 'allowed';
    const window = { utilization, resetsAt };
    const change: Partial<PlanLimits> = { available: true, status, limitedWindow: status === 'allowed' ? null : kind };
    if (kind === 'five_hour') change.fiveHour = window;
    else if (kind === 'seven_day' || kind === 'seven_day_opus' || kind === 'seven_day_sonnet') change.sevenDay = window;
    publish(change);

    if (status === 'allowed_warning') {
      const key = `${kind ?? 'plan'}:${resetsAt ?? 'unknown'}`;
      if (!warned.has(key)) {
        warned.add(key);
        const windowName = kind === 'five_hour' ? '5-hour window' : kind?.startsWith('seven_day') ? '7-day window' : 'plan';
        emit('toast', {
          id: `plan-limit:${key}`,
          tone: 'warning',
          title: PLAN_LIMIT_WARNING_TITLE,
          body: `${windowName}${utilization !== null ? ` at ${Math.round(utilization)}%` : ''}${resetsAt ? ` · ${formatResetTime(resetsAt, now())}` : ''}. Agents that hit it wait for the reset.`,
        });
      }
    } else if (status === 'rejected') {
      park(ticketId, resetsAt);
    }
  }

  const unsubscribe = sessions.subscribe(({ ticketId, message }) => handle(ticketId, message));

  return {
    get: () => limits,
    holdReason() {
      const threshold = options.holdPercent();
      const used = limits.available ? (limits.fiveHour?.utilization ?? 0) : 0;
      if (limits.status === 'rejected' && limits.limitedWindow !== null) {
        return `Waiting for the plan limit to reset${limits.fiveHour?.resetsAt ? ` · ${formatResetTime(limits.fiveHour.resetsAt, now())}` : ''}`;
      }
      if (threshold < 100 && used >= threshold) {
        return `Waiting for plan limit · 5-hour window at ${Math.round(used)}%${limits.fiveHour?.resetsAt ? ` · ${formatResetTime(limits.fiveHour.resetsAt, now())}` : ''}`;
      }
      return null;
    },
    dispose() {
      unsubscribe();
      for (const handle of timers.values()) clearTimer(handle);
      timers.clear();
    },
  };
}
