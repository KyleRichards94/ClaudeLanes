import { STAGES, type Gate, type Stage, type StageGates as Gates } from '@agent-lanes/contracts';
import { StyleSheet, View } from 'react-native';
import { color, radius, space } from '@agent-lanes/tokens';
import { Switch, Text } from '@agent-lanes/ui';
import { stageLabel } from '@/shared/config';

export interface StageGatesProps {
  gates: Gates;
  onChange: (stage: Stage, gate: Gate) => void;
}

const GATE_TEXT = { on: 'Needs approval', off: 'Auto' };

/**
 * Stage gates on artboard 2: one switch per stage, on when the agent stops for approval before
 * moving on ("Needs approval") and off when it carries on ("Auto"). Starts from the default gates in
 * settings (Planning and Create PR need approval).
 */
export function StageGates({ gates, onChange }: StageGatesProps) {
  return (
    <View style={styles.section} testID="stage-gates">
      <Text variant="title" size="md">
        Stage gates
      </Text>
      <View style={styles.list}>
        {STAGES.map((stage, index) => (
          <Switch
            key={stage}
            label={stageLabel(stage)}
            value={gates[stage] === 'approval'}
            stateText={GATE_TEXT}
            onValueChange={(on) => onChange(stage, on ? 'approval' : 'auto')}
            style={index > 0 ? styles.divided : undefined}
            testID={`gate-${stage}`}
          />
        ))}
      </View>
    </View>
  );
}

/** Read off artboard 2: five 48 px rows in a bordered 12 px list. */
const styles = StyleSheet.create({
  section: {
    gap: space.md,
  },
  list: {
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.control,
    backgroundColor: color.surface,
    overflow: 'hidden',
  },
  divided: {
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
});
