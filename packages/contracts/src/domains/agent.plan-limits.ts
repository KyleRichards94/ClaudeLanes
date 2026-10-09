import { z } from 'zod';
import { EventEnvelopeSchema, TicketIdSchema } from '../events';

/**
 * The claude.ai plan's rate limits (AL-258): the 5-hour and 7-day windows as Claude Code reports
 * them in `rate_limit_event` messages, shared by every agent session. API-key sessions have none.
 */

export const PlanLimitWindowSchema = z.object({
  /** Percentage of the window used, 0 to 100; null when the event gave none. */
  utilization: z.number().min(0).max(100).nullable(),
  /** When the window resets, epoch milliseconds; null when unknown. */
  resetsAt: z.int().nonnegative().nullable(),
});
export type PlanLimitWindow = z.infer<typeof PlanLimitWindowSchema>;

export const PLAN_LIMIT_STATUSES = ['allowed', 'allowed_warning', 'rejected'] as const;
export const PlanLimitStatusSchema = z.enum(PLAN_LIMIT_STATUSES);
export type PlanLimitStatus = z.infer<typeof PlanLimitStatusSchema>;

export const PLAN_LIMIT_WINDOWS = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet', 'overage'] as const;
export const PlanLimitWindowKindSchema = z.enum(PLAN_LIMIT_WINDOWS);
export type PlanLimitWindowKind = z.infer<typeof PlanLimitWindowKindSchema>;

export const PlanLimitsSchema = z.object({
  /** False until a session reported limits; stays false for API-key sign-ins, which have none. */
  available: z.boolean(),
  fiveHour: PlanLimitWindowSchema.nullable(),
  sevenDay: PlanLimitWindowSchema.nullable(),
  /** The latest event's status. */
  status: PlanLimitStatusSchema,
  /** The window the latest warning or rejection was about; null when it named none. */
  limitedWindow: PlanLimitWindowKindSchema.nullable(),
  /** Tickets whose agent waits for the window to reset after a rejection. */
  waitingTickets: z.array(TicketIdSchema).max(500),
  updatedAt: z.int().nonnegative().nullable(),
});
export type PlanLimits = z.infer<typeof PlanLimitsSchema>;

export function emptyPlanLimits(): PlanLimits {
  return { available: false, fiveHour: null, sevenDay: null, status: 'allowed', limitedWindow: null, waitingTickets: [], updatedAt: null };
}

/** `agent:planLimits`: the limits changed (an event arrived, a ticket started or stopped waiting). */
export const PlanLimitsEventSchema = EventEnvelopeSchema.extend({ limits: PlanLimitsSchema });
export type PlanLimitsEvent = z.infer<typeof PlanLimitsEventSchema>;

/** The hold on new launches: queued while the 5-hour window is at or over this share (Kyle, 2026-10-09). */
export const DEFAULT_LAUNCH_HOLD_PERCENT = 85;

/** "resets 15:20", local time; "resets tomorrow 09:00" for another day. */
export function formatResetTime(resetsAt: number, now = Date.now()): string {
  const reset = new Date(resetsAt);
  const time = `${String(reset.getHours()).padStart(2, '0')}:${String(reset.getMinutes()).padStart(2, '0')}`;
  const today = new Date(now);
  const sameDay = reset.getFullYear() === today.getFullYear() && reset.getMonth() === today.getMonth() && reset.getDate() === today.getDate();
  if (sameDay) return `resets ${time}`;
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const isTomorrow = reset.getFullYear() === tomorrow.getFullYear() && reset.getMonth() === tomorrow.getMonth() && reset.getDate() === tomorrow.getDate();
  return isTomorrow ? `resets tomorrow ${time}` : `resets ${reset.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${time}`;
}

/** "5h 62% · 7d 31%": the meter's words; "Plan limits unknown" before any event. */
export function planLimitsLabel(limits: Pick<PlanLimits, 'available' | 'fiveHour' | 'sevenDay'>): string {
  if (!limits.available) return 'Plan limits unknown';
  const parts: string[] = [];
  if (limits.fiveHour?.utilization !== null && limits.fiveHour?.utilization !== undefined) parts.push(`5h ${Math.round(limits.fiveHour.utilization)}%`);
  if (limits.sevenDay?.utilization !== null && limits.sevenDay?.utilization !== undefined) parts.push(`7d ${Math.round(limits.sevenDay.utilization)}%`);
  return parts.length > 0 ? parts.join(' · ') : 'Plan limits unknown';
}

/** The window the hold on launches reads: the 5-hour utilisation, 0 when unknown. */
export function fiveHourUtilization(limits: Pick<PlanLimits, 'available' | 'fiveHour'>): number {
  return limits.available ? (limits.fiveHour?.utilization ?? 0) : 0;
}
