import type { Gate, Stage, StageGates } from '@agent-lanes/contracts';
import { Pressable, StyleSheet, View } from 'react-native';
import { color, radius, space, tone } from '@agent-lanes/tokens';
import { Icon, Text } from '@agent-lanes/ui';
import type { ReactNode } from 'react';
import { LANE_LABELS } from '@/entities/agent-ticket';
import { formatDuration } from '../lib/format';
import type { StageStep } from '../lib/stage-steps';

export interface StageStepperProps {
  steps: readonly StageStep[];
  /** The current step's progress, 0 to 1 ("Implementing 46%"); null when unknown. */
  progress: number | null;
  /** The ticket's gates; each step then shows its Auto / Approval toggle (AL-171). */
  gates?: StageGates;
  onGateChange?: (stage: Stage, gate: Gate) => void;
  /** The stage whose gate waits for the user; its step turns amber. */
  waitingStage?: Stage | null;
  /** Approve / Request changes for the waiting gate, shown under the steps. */
  gateActions?: ReactNode;
}

/**
 * The five stages as pills joined by short rules (artboard 3): done with a green check and its
 * duration, current in violet with its number and progress, upcoming in grey. With `gates`, each step
 * carries its gate toggle (Approval / Auto, AL-171); the step whose gate waits turns amber and the
 * Approve / Request changes actions show under the row.
 */
export function StageStepper({ steps, progress, gates, onGateChange, waitingStage = null, gateActions }: StageStepperProps) {
  return (
    <View style={styles.stepper}>
      <View style={styles.row} role="list" aria-label="Stages" testID="stage-stepper">
        {steps.map((step, index) => (
          <View key={step.stage} style={styles.item}>
            {index > 0 ? <View style={styles.rule} aria-hidden /> : null}
            <StepPill
              step={step}
              number={index + 1}
              progress={step.state === 'current' ? progress : null}
              waiting={waitingStage === step.stage}
            />
            {gates && onGateChange ? (
              <GateToggle stage={step.stage} gate={gates[step.stage]} onChange={(gate) => onGateChange(step.stage, gate)} />
            ) : null}
          </View>
        ))}
      </View>
      {gateActions}
    </View>
  );
}

/** A step's gate: "Approval" with a lock when the agent stops for you before moving on, "Auto" when it does not. */
function GateToggle({ stage, gate, onChange }: { stage: Stage; gate: Gate; onChange: (gate: Gate) => void }) {
  const on = gate === 'approval';
  return (
    <Pressable
      role="switch"
      aria-checked={on}
      aria-label={`${LANE_LABELS[stage]} gate, ${on ? 'needs approval' : 'auto'}`}
      onPress={() => onChange(on ? 'auto' : 'approval')}
      hitSlop={8}
      style={({ pressed }) => [styles.toggle, on && styles.toggleOn, pressed && styles.togglePressed]}
      testID={`stage-gate-${stage}`}
    >
      {on ? <Icon name="lock" size={11} color={color.claudeText} /> : null}
      <Text variant="meta" size="xs" color={on ? color.claudeText : color.muted}>
        {on ? 'Approval' : 'Auto'}
      </Text>
    </Pressable>
  );
}

const STATE_WORDS: Record<StageStep['state'], string> = { done: 'done', current: 'current stage', upcoming: 'upcoming' };

function StepPill({ step, number, progress, waiting }: { step: StageStep; number: number; progress: number | null; waiting: boolean }) {
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
      aria-label={`${label}, ${STATE_WORDS[step.state]}${detail ? `, ${detail}` : ''}${waiting ? ', waiting for approval' : ''}`}
      style={[styles.pill, current && styles.pillCurrent, waiting && styles.pillWaiting]}
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
  stepper: {
    gap: space.md,
    alignItems: 'flex-start',
  },
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
  pillWaiting: {
    borderColor: tone.attention.border,
    backgroundColor: tone.attention.band,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  toggleOn: {
    borderColor: tone.claude.band,
    backgroundColor: tone.claude.band,
  },
  togglePressed: {
    opacity: 0.8,
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
