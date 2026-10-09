import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { formatCostUsd, formatTokenCount, type AgentUsage } from '@agent-lanes/contracts';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Text } from '@agent-lanes/ui';

export interface UsageStripProps {
  usage: AgentUsage | undefined;
  testID?: string;
}

/** Context fullness from which the bar turns amber, then red (AL-257). */
export const CONTEXT_WARN_PERCENT = 70;
export const CONTEXT_DANGER_PERCENT = 90;

/** The bar's tone for a context percentage. */
export function contextTone(percentage: number): 'ok' | 'attention' | 'danger' {
  return percentage >= CONTEXT_DANGER_PERCENT ? 'danger' : percentage >= CONTEXT_WARN_PERCENT ? 'attention' : 'ok';
}

/** "412k tokens · $1.24", with the turn in progress counted (AL-257). */
export function usageStripLabel(usage: Pick<AgentUsage, 'totalTokens' | 'turnTokens' | 'costUsd'>): string {
  const tokens = usage.totalTokens + usage.turnTokens;
  return `${formatTokenCount(tokens)} · ${formatCostUsd(usage.costUsd)}`;
}

/** The hover detail: input, output and cache tokens, and the turn in progress. */
export function usageStripDetails(usage: AgentUsage): string {
  const parts = [
    `Input ${formatTokenCount(usage.inputTokens)}`,
    `Output ${formatTokenCount(usage.outputTokens)}`,
    `Cache read ${formatTokenCount(usage.cacheReadInputTokens)}`,
    `Cache write ${formatTokenCount(usage.cacheCreationInputTokens)}`,
  ];
  if (usage.turnTokens > 0) parts.push(`This turn so far ${formatTokenCount(usage.turnTokens)}`);
  if (usage.context && usage.context.maxTokens > 0) parts.push(`Context ${formatTokenCount(usage.context.usedTokens)} of ${formatTokenCount(usage.context.maxTokens).replace(/ tokens$/, '')}`);
  return parts.join(' · ');
}

/**
 * The header band's usage strip (AL-257): the context window as a bar that turns amber from 70% and
 * red from 90%, then the session's tokens and cost, live during a turn. Hover for the breakdown.
 */
export function UsageStrip({ usage, testID = 'usage-strip' }: UsageStripProps) {
  const [open, setOpen] = useState(false);
  if (!usage || (usage.totalTokens === 0 && usage.turnTokens === 0 && !usage.context)) return null;
  const percentage = usage.context && usage.context.maxTokens > 0 ? Math.min(100, Math.max(0, usage.context.percentage)) : null;
  const barTone = percentage === null ? 'ok' : contextTone(percentage);
  const label = usageStripLabel(usage);
  const details = usageStripDetails(usage);

  return (
    <Pressable
      aria-label={`${percentage === null ? '' : `Context ${Math.round(percentage)}% full. `}${label}. ${details}`}
      onHoverIn={() => setOpen(true)}
      onHoverOut={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      style={styles.strip}
      testID={testID}
    >
      {percentage !== null ? (
        <View style={styles.bar} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percentage)} aria-label="Context window" testID={`${testID}-context`}>
          <View style={[styles.fill, { width: `${percentage}%`, backgroundColor: tone[barTone].dot }]} />
          <Text variant="meta" size="xs" style={styles.barLabel} color={percentage >= 55 ? color.surface : color.muted}>
            {`${Math.round(percentage)}%`}
          </Text>
        </View>
      ) : null}
      <Text variant="meta" size="sm" numberOfLines={1} testID={`${testID}-label`}>
        {label}
      </Text>
      {open ? (
        <View role="tooltip" style={styles.tooltip} testID={`${testID}-tooltip`}>
          <Text variant="body" size="sm" color={color.surface}>
            {details}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 28,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  bar: {
    width: 72,
    height: 14,
    borderRadius: 7,
    backgroundColor: color.bg,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
  barLabel: {
    textAlign: 'center',
    lineHeight: 14,
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
    minWidth: 280,
  },
});
