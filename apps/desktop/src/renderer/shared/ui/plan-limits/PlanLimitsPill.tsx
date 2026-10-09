import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatResetTime, planLimitsLabel, type PlanLimits } from '@agent-lanes/contracts';
import { color, radius, space } from '@agent-lanes/tokens';
import { Pill, Text, type PillTone } from '@agent-lanes/ui';
import { usePlanLimits } from '@/shared/api';

/** Use from which the meter turns amber, then red. */
export const PLAN_LIMIT_WARN_PERCENT = 70;
export const PLAN_LIMIT_DANGER_PERCENT = 90;

/** What the meter says for the limits (AL-258): "5h 62% · 7d 31%", its tone, and the reset times on hover. */
export function planLimitsView(limits: PlanLimits | undefined, now = Date.now()): { label: string; tone: PillTone; hint: string | null; visible: boolean } {
  if (!limits || !limits.available) return { label: 'Plan limits unknown', tone: 'neutral', hint: null, visible: false };
  const used = Math.max(limits.fiveHour?.utilization ?? 0, limits.sevenDay?.utilization ?? 0);
  const tone: PillTone = limits.status === 'rejected' || used >= PLAN_LIMIT_DANGER_PERCENT ? 'danger' : limits.status === 'allowed_warning' || used >= PLAN_LIMIT_WARN_PERCENT ? 'attention' : 'ok';
  const resets = [
    limits.fiveHour?.resetsAt ? `5-hour window ${formatResetTime(limits.fiveHour.resetsAt, now)}` : null,
    limits.sevenDay?.resetsAt ? `7-day window ${formatResetTime(limits.sevenDay.resetsAt, now)}` : null,
    limits.waitingTickets.length > 0 ? `Waiting for the reset: ${limits.waitingTickets.map((id) => `#${id}`).join(', ')}` : null,
  ].filter((part): part is string => part !== null);
  return { label: planLimitsLabel(limits), tone, hint: resets.length > 0 ? resets.join(' · ') : null, visible: true };
}

/**
 * The plan-limits meter (AL-258): in the board header beside the live counts and in the ticket
 * header band. Hidden until a session reports limits (API-key sign-ins never do).
 */
export function PlanLimitsPill({ testID = 'plan-limits-pill' }: { testID?: string }) {
  const limits = usePlanLimits();
  const [open, setOpen] = useState(false);
  const view = planLimitsView(limits.data);
  if (!view.visible) return null;
  return (
    <Pressable
      aria-label={view.hint ? `${view.label}. ${view.hint}` : view.label}
      onHoverIn={() => setOpen(true)}
      onHoverOut={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      style={styles.anchor}
      testID={testID}
    >
      <Pill size="md" tone={view.tone} dot label={view.label} testID={`${testID}-label`} />
      {open && view.hint ? (
        <View role="tooltip" style={styles.tooltip} testID={`${testID}-tooltip`}>
          <Text variant="body" size="sm" color={color.surface}>
            {view.hint}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'relative',
  },
  tooltip: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: space.xs,
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.xs + 2,
    borderRadius: radius.chip,
    backgroundColor: color.ink,
    zIndex: 10,
    minWidth: 260,
  },
});
