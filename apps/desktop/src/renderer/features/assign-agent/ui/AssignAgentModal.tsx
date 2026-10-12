import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { EFFORTS, MODELS, STAGES, type AssignAgentMode, type Effort, type Model, type Stage } from '@agent-lanes/contracts';
import { color, space, tone } from '@agent-lanes/tokens';
import { Button, Modal, SegmentedControl, Text, TextField } from '@agent-lanes/ui';
import { useAgentTicket } from '@/entities/agent-ticket';
import { EFFORT_LABELS, LANE_LABELS, MODEL_LABELS } from '@/shared/config';
import { toast } from '@/shared/model';
import { useAssignAgent } from '../api/assign';
import { ASSIGN_MODE_HELP, ASSIGN_MODE_OPTIONS, FORK_MODE_OPTION, defaultStage, formatSkills, parseSkillNames } from '../model/draft';

/** The Agent menu item that opens the dialog. */
export const ASSIGN_AGENT_KEY = 'assign-agent';

const MODEL_OPTIONS = MODELS.map((model) => ({ value: model, label: MODEL_LABELS[model] }));
const EFFORT_OPTIONS = EFFORTS.map((effort) => ({ value: effort, label: EFFORT_LABELS[effort] }));
const STAGE_OPTIONS = STAGES.map((stage) => ({ value: stage, label: LANE_LABELS[stage] }));

export interface AssignAgentModalProps {
  ticketId: string;
  /** The ticket's current skills, to start the field from. */
  skills: readonly string[];
  visible: boolean;
  onClose(): void;
  /** Fork from here (AL-265): the user message the new session's history ends at; the dialog then starts on "Start from fork". */
  fork?: string | null;
  testID?: string;
}

/**
 * Assign new agent (AL-263): picks the model, effort, skills and the stage to start from, and whether
 * the new agent gets a hand-over brief (the default) or starts fresh. The dialog's state starts from
 * the ticket each time it opens.
 */
export function AssignAgentModal({ ticketId, skills, visible, onClose, fork = null, testID = 'assign-agent' }: AssignAgentModalProps) {
  return visible ? <AssignAgentDialog ticketId={ticketId} skills={skills} onClose={onClose} fork={fork} testID={testID} /> : null;
}

function AssignAgentDialog({ ticketId, skills: initialSkills, onClose, fork = null, testID }: Omit<AssignAgentModalProps, 'visible'> & { testID: string }) {
  const ticket = useAgentTicket(ticketId);
  const assign = useAssignAgent(ticketId);
  const [model, setModel] = useState<Model>(ticket?.model ?? 'opus');
  const [effort, setEffort] = useState<Effort>(ticket?.effort ?? 'high');
  const [skills, setSkills] = useState(() => formatSkills(initialSkills));
  const [stage, setStage] = useState<Stage>(defaultStage(ticket?.stage));
  const [mode, setMode] = useState<AssignAgentMode>(fork ? 'fork' : 'hand-over');
  const modeOptions = fork ? [FORK_MODE_OPTION, ...ASSIGN_MODE_OPTIONS] : ASSIGN_MODE_OPTIONS;
  const [failure, setFailure] = useState<string | null>(null);

  const submit = () => {
    setFailure(null);
    assign.mutate(
      { model, effort, skills: parseSkillNames(skills), stage, mode, ...(mode === 'fork' && fork ? { forkFromMessageId: fork } : {}) },
      {
        onSuccess: () => {
          toast({ id: `assign:${ticketId}`, tone: 'success', title: `New ${MODEL_LABELS[model]} agent on ${ticket?.ado ? `#${ticket.ado.workItemId}` : ticketId}`, body: mode === 'hand-over' ? 'It starts from a hand-over brief.' : mode === 'fork' ? 'It continues from the forked session.' : 'It starts fresh from the original job.' });
          onClose();
        },
        onError: (error) => setFailure(error.message),
      },
    );
  };

  return (
    <Modal
      visible
      title="Assign a new agent"
      subtitle={ticket?.title ?? ticketId}
      icon="add-agent"
      onClose={assign.isPending ? () => undefined : onClose}
      width={560}
      footer={
        <View style={styles.footer}>
          <Button variant="secondary" label="Cancel" onPress={onClose} disabled={assign.isPending} />
          <Button variant="primary" label="Assign agent" onPress={submit} loading={assign.isPending} testID={`${testID}-confirm`} />
        </View>
      }
      testID={`${testID}-modal`}
    >
      <View style={styles.body}>
        <Text variant="body" size="md">
          Ends the current agent and starts another in the same worktree and branch. The output so far stays above the new agent's.
        </Text>
        <View style={styles.field}>
          <Text variant="meta" size="sm">
            Model
          </Text>
          <SegmentedControl<Model> label="Model" value={model} onChange={setModel} options={MODEL_OPTIONS} fill disabled={assign.isPending} testID={`${testID}-model`} />
        </View>
        <View style={styles.field}>
          <Text variant="meta" size="sm">
            Effort
          </Text>
          <SegmentedControl<Effort> label="Effort" value={effort} onChange={setEffort} options={EFFORT_OPTIONS} fill disabled={assign.isPending} testID={`${testID}-effort`} />
        </View>
        <TextField
          label="Skills"
          value={skills}
          onChangeText={setSkills}
          placeholder="/code-review /commit"
          help="Names with or without the slash, separated by spaces or commas."
          testID={`${testID}-skills`}
        />
        <View style={styles.field}>
          <Text variant="meta" size="sm">
            Start from stage
          </Text>
          <SegmentedControl<Stage> label="Start from stage" value={stage} onChange={setStage} options={STAGE_OPTIONS} fill disabled={assign.isPending} testID={`${testID}-stage`} />
        </View>
        <View style={styles.field}>
          <Text variant="meta" size="sm">
            Context
          </Text>
          <SegmentedControl<AssignAgentMode> label="Context" value={mode} onChange={setMode} options={modeOptions} fill disabled={assign.isPending} testID={`${testID}-mode`} />
          <Text variant="body" size="sm" color={color.muted} testID={`${testID}-mode-help`}>
            {ASSIGN_MODE_HELP[mode]}
          </Text>
        </View>
        {failure ? (
          <Text variant="body" size="sm" color={tone.danger.text} role="alert" testID={`${testID}-error`}>
            {failure}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  body: {
    gap: space.lg,
  },
  field: {
    gap: space.xs,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space.sm,
  },
});
