import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { EFFORTS, MODELS, type Effort, type Model, type TicketCompanionRole } from '@agent-lanes/contracts';
import { color, space, tone } from '@agent-lanes/tokens';
import { Button, Modal, SegmentedControl, Text, TextField } from '@agent-lanes/ui';
import { useAgentTicket } from '@/entities/agent-ticket';
import { EFFORT_LABELS, MODEL_LABELS } from '@/shared/config';
import { toast } from '@/shared/model';
import { useAddAgent } from '../api/add';
import { COMPANION_ROLE_HELP, COMPANION_ROLE_OPTIONS, defaultCompanionName, defaultCompanionPrompt, formatSkills, parseSkillNames } from '../model/draft';

const MODEL_OPTIONS = MODELS.map((model) => ({ value: model, label: MODEL_LABELS[model] }));
const EFFORT_OPTIONS = EFFORTS.map((effort) => ({ value: effort, label: EFFORT_LABELS[effort] }));

export interface AddAgentModalProps {
  ticketId: string;
  /** The ticket's current skills, to start the field from. */
  skills: readonly string[];
  visible: boolean;
  onClose(): void;
  /** The companion started: the page switches its output to it. */
  onAdded?(companionId: string): void;
  testID?: string;
}

/**
 * Add agent (AL-266): a second agent beside the lead. A read-only Reviewer in the same worktree, or
 * a Helper on its own `sub/<ticket>-<name>` branch; with its name, model, effort, skills and task.
 */
export function AddAgentModal({ ticketId, skills, visible, onClose, onAdded, testID = 'add-agent' }: AddAgentModalProps) {
  return visible ? <AddAgentDialog ticketId={ticketId} skills={skills} onClose={onClose} onAdded={onAdded} testID={testID} /> : null;
}

function AddAgentDialog({ ticketId, skills: initialSkills, onClose, onAdded, testID }: Omit<AddAgentModalProps, 'visible'> & { testID: string }) {
  const ticket = useAgentTicket(ticketId);
  const add = useAddAgent(ticketId);
  const [role, setRole] = useState<TicketCompanionRole>('reviewer');
  const [name, setName] = useState(() => defaultCompanionName('reviewer'));
  const [prompt, setPrompt] = useState(() => defaultCompanionPrompt('reviewer'));
  const [model, setModel] = useState<Model>('sonnet');
  const [effort, setEffort] = useState<Effort>('high');
  const [skills, setSkills] = useState(() => formatSkills(initialSkills));
  const [failure, setFailure] = useState<string | null>(null);

  // Switching the role swaps in its default name and task unless the user has written their own.
  const changeRole = (next: TicketCompanionRole) => {
    if (name.trim() === '' || name === defaultCompanionName(role)) setName(defaultCompanionName(next));
    if (prompt.trim() === '' || prompt === defaultCompanionPrompt(role)) setPrompt(defaultCompanionPrompt(next));
    setRole(next);
  };

  const submit = () => {
    setFailure(null);
    if (!name.trim()) return setFailure('Give the agent a name.');
    if (!prompt.trim()) return setFailure('Say what the agent should do.');
    add.mutate(
      { role, name: name.trim(), model, effort, skills: parseSkillNames(skills), prompt: prompt.trim() },
      {
        onSuccess: ({ companionId }) => {
          toast({ id: `add-agent:${companionId}`, tone: 'success', title: `${role === 'reviewer' ? 'Reviewer' : 'Helper'} "${name.trim()}" added`, body: role === 'reviewer' ? 'It reads the ticket worktree beside the lead agent.' : 'It works on its own sub-branch; its commits show in Sub-branches.' });
          onAdded?.(companionId);
          onClose();
        },
        onError: (error) => setFailure(error.message),
      },
    );
  };

  return (
    <Modal
      visible
      title="Add an agent"
      subtitle={ticket?.title ?? ticketId}
      icon="add-agent"
      onClose={add.isPending ? () => undefined : onClose}
      width={560}
      footer={
        <View style={styles.footer}>
          <Button variant="secondary" label="Cancel" onPress={onClose} disabled={add.isPending} />
          <Button variant="primary" label="Add agent" onPress={submit} loading={add.isPending} testID={`${testID}-confirm`} />
        </View>
      }
      testID={`${testID}-modal`}
    >
      <View style={styles.body}>
        <Text variant="body" size="md">
          Runs a second agent beside the lead, with its own output and composer. Stopping one leaves the other running.
        </Text>
        <View style={styles.field}>
          <Text variant="meta" size="sm">
            Role
          </Text>
          <SegmentedControl<TicketCompanionRole> label="Role" value={role} onChange={changeRole} options={COMPANION_ROLE_OPTIONS} fill disabled={add.isPending} testID={`${testID}-role`} />
          <Text variant="body" size="sm" color={color.muted} testID={`${testID}-role-help`}>
            {COMPANION_ROLE_HELP[role]}
          </Text>
        </View>
        <TextField label="Name" value={name} onChangeText={setName} placeholder={defaultCompanionName(role)} help="Names the agent in the switcher; a helper's branch is sub/<ticket>-<name>." testID={`${testID}-name`} />
        <TextField variant="multiline" label="What should it do?" value={prompt} onChangeText={setPrompt} placeholder={defaultCompanionPrompt(role)} testID={`${testID}-prompt`} />
        <View style={styles.field}>
          <Text variant="meta" size="sm">
            Model
          </Text>
          <SegmentedControl<Model> label="Model" value={model} onChange={setModel} options={MODEL_OPTIONS} fill disabled={add.isPending} testID={`${testID}-model`} />
        </View>
        <View style={styles.field}>
          <Text variant="meta" size="sm">
            Effort
          </Text>
          <SegmentedControl<Effort> label="Effort" value={effort} onChange={setEffort} options={EFFORT_OPTIONS} fill disabled={add.isPending} testID={`${testID}-effort`} />
        </View>
        <TextField label="Skills" value={skills} onChangeText={setSkills} placeholder="/code-review" help="Names with or without the slash, separated by spaces or commas." testID={`${testID}-skills`} />
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
