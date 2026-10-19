import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { Gate, Stage } from '@agent-lanes/contracts';
import { color, progressGradient, radius, space, tone } from '@agent-lanes/tokens';
import { GlassPanel, Icon, Pill, Text } from '@agent-lanes/ui';
import type { AgentView } from '@/entities/agent';
import type { Turn } from '@/entities/turn';
import { usePrefersReducedMotion } from '@/shared/lib';
import type { WorkflowStage } from '../model/stage-meta';
import { shimmerStyle, web } from './motion';
import { TurnStrip } from './TurnStrip';

export interface WorkflowCardProps {
  stages: readonly WorkflowStage[];
  /** The gate chips toggle Auto / Approval when this is given. */
  onGateChange?: (stage: Stage, gate: Gate) => void;
  turns: readonly Turn[];
  agents: readonly AgentView[];
  selectedTurn: number | null;
  onSelectTurn(index: number): void;
  /** Approve / Request changes for the gate that waits, under the cards. */
  gateActions?: ReactNode;
  /** Anything that needs the user's eye above the body: the permission banner, the queued notice, a gate error. */
  notices?: ReactNode;
  testID?: string;
}

/** The narrowest a stage card gets before the row scrolls sideways. */
const CARD_MIN_WIDTH = 150;

/**
 * The workflow card (handoff "Flight deck > Workflow card"): the five stages as cards in a row, the current one
 * wider, each with its number or check, its name, a gate chip you can press to change the gate, and a meta line;
 * the current one has a progress bar. Under them, the turn strip, then the waiting gate's actions and notices.
 */
export function WorkflowCard({ stages, onGateChange, turns, agents, selectedTurn, onSelectTurn, gateActions, notices, testID = 'workflow-card' }: WorkflowCardProps) {
  return (
    <GlassPanel level="md" style={styles.card} testID={testID}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.row} role="list" aria-label="Stages" testID="stage-stepper">
        {stages.map((stage) => (
          <StageCard key={stage.stage} stage={stage} {...(onGateChange ? { onGateChange } : {})} />
        ))}
      </ScrollView>
      <TurnStrip turns={turns} agents={agents} selectedTurn={selectedTurn} onSelectTurn={onSelectTurn} />
      {gateActions}
      {notices}
    </GlassPanel>
  );
}

function StageCard({ stage, onGateChange }: { stage: WorkflowStage; onGateChange?: (stage: Stage, gate: Gate) => void }) {
  const current = stage.state === 'current';
  const done = stage.state === 'done';
  return (
    <View
      role="listitem"
      aria-label={stage.name}
      style={[styles.stage, current ? styles.stageCurrent : styles.stageIdle, done && styles.stageDone, stage.waiting && styles.stageWaiting]}
      testID={`stage-step-${stage.stage}`}
    >
      <View style={styles.head}>
        <View style={[styles.marker, done ? styles.markerDone : current ? styles.markerCurrent : styles.markerUpcoming]}>
          {done ? (
            <Icon name="check" color={color.onInk} size={12} />
          ) : (
            <Text variant="title" size="xs" color={current ? color.onAccent : tone.neutral.text}>
              {String(stage.number)}
            </Text>
          )}
        </View>
        <Text variant="title" size="md" color={current ? color.claudeText : color.ink} numberOfLines={1} style={styles.name}>
          {stage.label}
        </Text>
        <GateChip stage={stage} {...(onGateChange ? { onGateChange } : {})} />
      </View>
      <Text variant="meta" size="sm" color={stage.waiting ? tone.attention.text : color.muted} numberOfLines={2} style={stage.waiting ? styles.waitingText : undefined} testID={`stage-meta-${stage.stage}`}>
        {stage.meta}
      </Text>
      {current ? <StageBar progress={stage.progress} label={`${stage.label} progress`} /> : null}
    </View>
  );
}

/** Approved (green), Approval (amber) or Auto (grey); pressing it flips the stage's gate, as the stepper's toggle did. */
function GateChip({ stage, onGateChange }: { stage: WorkflowStage; onGateChange?: (stage: Stage, gate: Gate) => void }) {
  const on = stage.gate === 'approval';
  const chip = <Pill label={stage.gateLabel} tone={stage.gateTone} size="sm" />;
  if (!onGateChange) return chip;
  return (
    <Pressable
      role="switch"
      aria-checked={on}
      aria-label={`${stage.label} gate, ${on ? 'needs approval' : 'auto'}`}
      onPress={() => onGateChange(stage.stage, on ? 'auto' : 'approval')}
      hitSlop={8}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
      testID={`stage-gate-${stage.stage}`}
    >
      {chip}
    </Pressable>
  );
}

/** The current stage's 5 px bar: violet into sky up to its progress, or a shimmer while it is not known. */
function StageBar({ progress, label }: { progress: number | null; label: string }) {
  const reduced = usePrefersReducedMotion();
  const gradient = web({ backgroundImage: `linear-gradient(90deg, ${progressGradient.from}, ${progressGradient.to})` });
  if (progress === null) {
    return (
      <View role="progressbar" aria-label={label} aria-valuetext="In progress" style={styles.track} testID="stage-progress">
        <View style={[styles.indeterminate, gradient, reduced ? null : shimmerStyle]} />
      </View>
    );
  }
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <View role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} style={styles.track} testID="stage-progress">
      <View style={[styles.fill, { width: `${percent}%`, backgroundColor: progressGradient.from }, gradient]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.md,
    padding: space.md,
    borderRadius: radius.panel,
  },
  scroll: {
    flexGrow: 0,
  },
  row: {
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: space.sm,
  },
  stage: {
    flexShrink: 0,
    flexBasis: CARD_MIN_WIDTH,
    minWidth: CARD_MIN_WIDTH,
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
  },
  // The current stage takes half as much room again.
  stageCurrent: {
    flexGrow: 1.5,
    borderColor: tone.claude.border,
    backgroundColor: tone.claude.wash,
  },
  stageIdle: {
    flexGrow: 1,
    borderColor: color.line,
    backgroundColor: 'rgba(255, 255, 255, 0.7)',
  },
  stageDone: {
    backgroundColor: 'rgba(255, 255, 255, 0.85)',
  },
  stageWaiting: {
    borderColor: tone.attention.border,
    backgroundColor: tone.attention.band,
  },
  waitingText: {
    fontWeight: '700',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  name: {
    flexShrink: 1,
    minWidth: 0,
    fontWeight: '800',
  },
  chip: {
    marginLeft: 'auto',
    flexShrink: 0,
    borderRadius: radius.pill,
  },
  pressed: {
    opacity: 0.8,
  },
  marker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
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
  track: {
    height: 5,
    marginTop: space.xs,
    borderRadius: radius.pill,
    backgroundColor: color.line,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
  },
  indeterminate: {
    width: '40%',
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: progressGradient.from,
  },
});
