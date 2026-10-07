import { StyleSheet, View } from 'react-native';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Icon, Text } from '@agent-lanes/ui';
import { LANE_LABELS } from '@/entities/agent-ticket';
import { formatDuration } from '../lib/format';
import type { StageStep } from '../lib/stage-steps';

export interface StageStepperProps {
  steps: readonly StageStep[];
  /** The current step's progress, 0 to 1 ("Implementing 46%"); null when unknown. */
  progress: number | null;
}

/**
 * The five stages as pills joined by short rules (artboard 3): done with a green check and its
 * duration, current in violet with its number and progress, upcoming in grey. Read-only here; the
 * gate actions and toggles are AL-171's.
 */
export function StageStepper({ steps, progress }: StageStepperProps) {
  return (
    <View style={styles.row} role="list" aria-label="Stages" testID="stage-stepper">
      {steps.map((step, index) => (
        <View key={step.stage} style={styles.item}>
          {index > 0 ? <View style={styles.rule} aria-hidden /> : null}
          <StepPill step={step} number={index + 1} progress={step.state === 'current' ? progress : null} />
        </View>
      ))}
    </View>
  );
}

const STATE_WORDS: Record<StageStep['state'], string> = { done: 'done', current: 'current stage', upcoming: 'upcoming' };

function StepPill({ step, number, progress }: { step: StageStep; number: number; progress: number | null }) {
  const label = LANE_LABELS[step.stage];
  const detail =
    step.state === 'done' && step.durationMs !== null
      ? formatDuration(step.durationMs)
      : step.state === 'current' && progress !== null
        ? `${Math.round(progress * 100)}%`
        : null;
  const current = step.state === 'current';

  return (
    <View
      role="listitem"
      aria-label={`${label}, ${STATE_WORDS[step.state]}${detail ? `, ${detail}` : ''}`}
      style={[styles.pill, current && styles.pillCurrent]}
      testID={`stage-step-${step.stage}`}
    >
      <View style={[styles.marker, step.state === 'done' ? styles.markerDone : current ? styles.markerCurrent : styles.markerUpcoming]}>
        {step.state === 'done' ? (
          <Icon name="check" color={color.surface} size={12} />
        ) : (
          <Text variant="title" size="xs" color={current ? color.surface : tone.neutral.text}>
            {String(number)}
          </Text>
        )}
      </View>
      <Text variant="title" color={current ? color.claudeText : color.ink}>
        {label}
      </Text>
      {detail ? (
        <Text variant={current ? 'title' : 'body'} color={current ? color.claude : color.muted}>
          {detail}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    rowGap: space.sm,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rule: {
    width: 16,
    height: 2,
    marginHorizontal: space.sm,
    borderRadius: 1,
    backgroundColor: color.line,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 38,
    paddingLeft: 6,
    paddingRight: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  pillCurrent: {
    borderColor: tone.claude.band,
    backgroundColor: tone.claude.band,
  },
  marker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerDone: {
    backgroundColor: color.ok,
  },
  markerCurrent: {
    backgroundColor: color.claude,
  },
  markerUpcoming: {
    backgroundColor: tone.neutral.band,
  },
});
