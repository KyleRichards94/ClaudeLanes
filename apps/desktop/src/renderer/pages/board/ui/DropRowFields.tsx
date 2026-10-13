import { EFFORTS, MODELS } from '@agent-lanes/contracts';
import { StyleSheet, View } from 'react-native';
import { space } from '@agent-lanes/tokens';
import { SegmentedControl, TextField } from '@agent-lanes/ui';
import { EFFORT_LABELS, MODEL_LABELS } from '@/shared/config';
import type { DropDraft } from '../model/settings-draft';

const MODEL_OPTIONS = MODELS.map((model) => ({ value: model, label: MODEL_LABELS[model] }));
const EFFORT_OPTIONS = EFFORTS.map((effort) => ({ value: effort, label: EFFORT_LABELS[effort] }));

export interface DropRowFieldsProps {
  /** "Planning · To Do, Failed, backlog or your In Progress item". */
  label: string;
  row: DropDraft;
  onChange(change: Partial<DropDraft>): void;
  errors?: { skills?: string | undefined; prompt?: string | undefined };
  testID: string;
}

/**
 * One Settings › Drops row (AL-240): the skills an agent started by that drop runs, the initial prompt
 * added to its first turn, and its model and effort. Settings › Drops and a lane's settings button share it.
 */
export function DropRowFields({ label, row, onChange, errors = {}, testID }: DropRowFieldsProps) {
  return (
    <View style={styles.row} testID={testID}>
      <TextField
        label={label}
        value={row.skills}
        onChangeText={(skills) => onChange({ skills })}
        placeholder="No skills"
        help="Skills, in the order they run; then the initial prompt, model and effort."
        error={errors.skills}
        testID={`${testID}-skills`}
      />
      <TextField
        variant="multiline"
        label={`${label}: initial prompt`}
        value={row.prompt}
        onChangeText={(prompt) => onChange({ prompt })}
        placeholder="Nothing added"
        help="Added to the agent's first message, after what the app asks it to do."
        error={errors.prompt}
        testID={`${testID}-prompt`}
      />
      <SegmentedControl label={`${label}: model`} options={MODEL_OPTIONS} value={row.model} onChange={(model) => onChange({ model })} fill />
      <SegmentedControl label={`${label}: effort`} options={EFFORT_OPTIONS} value={row.effort} onChange={(effort) => onChange({ effort })} fill />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: space.sm,
  },
});
